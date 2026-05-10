import type { Message } from 'discord.js';
import { Event } from '../handler/EventHandler.js';
import { askAgent, DISCLAIMER } from '../ai/agent.js';
import {
    startChain,
    findChainByBotMessage,
    getHistory,
    recordExchange,
    syntheticHistory,
} from '../ai/history.js';
import { messagesProcessed } from '../util/metrics.js';

// Reply to a message, falling back to a plain channel send if the message was deleted.
// On fallback, the user's original question is quoted so context isn't lost.
async function safeReply(
    target: Message<boolean>,
    content: string,
    fallbackQuestion?: string,
): Promise<Message<boolean>> {
    try {
        return await target.reply(content);
    } catch {
        const prefix = fallbackQuestion
            ? `> ${fallbackQuestion.split('\n').join('\n> ')}\n\n`
            : '';
        // We're always in a guild text channel — cast away the DM/group-DM variants
        const ch = target.channel as { send(content: string): Promise<Message<boolean>> };
        return await ch.send(`${prefix}${content}`);
    }
}

function splitMessage(text: string, maxLength = 2000): string[] {
    if (text.length <= maxLength) return [text];

    const parts: string[] = [];
    let remaining = text;

    while (remaining.length > maxLength) {
        // Probeer te splitsen op een newline binnen het limiet
        let splitAt = remaining.lastIndexOf('\n', maxLength);
        if (splitAt <= 0) splitAt = maxLength;
        parts.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining.length > 0) parts.push(remaining);
    return parts;
}

export default class MessageCreate extends Event<'messageCreate'> {
    public event = 'messageCreate' as const;

    public async run(msg: Message<true>): Promise<void> {
        if (!msg.guild) return;
        if (msg.author.bot) return;

        const botId = this.client.user.id;
        const mentionPrefix = `<@${botId}>`;
        const isMention = msg.content.startsWith(mentionPrefix);
        const botIsTagged = msg.mentions.users.has(botId);

        // Look up existing chain for the referenced message
        let existingChainId: string | undefined;
        if (msg.reference?.messageId) {
            existingChainId = findChainByBotMessage(msg.reference.messageId);
        }

        // Fetch the referenced message for context injection + restart detection
        let referencedMsg: Message<boolean> | undefined;
        if (msg.reference?.messageId) {
            try {
                referencedMsg = await msg.channel.messages.fetch(msg.reference.messageId);
            } catch { /* deleted or unavailable */ }
        }

        const isReplyToBot = referencedMsg?.author.id === botId;
        const isChainContinuation = existingChainId !== undefined && botIsTagged;
        // After a restart the chain is lost — if the user replies to an old bot message
        // with the mention toggle on, treat it as a fresh chain with context.
        const isRestartReply = isReplyToBot && existingChainId === undefined && botIsTagged;

        if (!isMention && !isChainContinuation && !isRestartReply) return;

        messagesProcessed.inc({ guild: msg.guild.id });

        // Strip mention prefix from question
        const question = isMention
            ? msg.content.slice(mentionPrefix.length).trim()
            : msg.content.trim();

        if (!question) {
            await msg.reply(
                'Hallo! Stel me een vraag over het OER of de ECTS-studiegids van AP Hogeschool.',
            );
            return;
        }

        // Pass roles regardless of guild — role names may carry context anywhere.
        // Server name is always passed as a fallback hint for opleiding detection.
        const userRoles =
            msg.member?.roles.cache
                .filter((r) => r.name !== '@everyone')
                .map((r) => r.name) ?? [];
        const serverName = msg.guild.name;

        // Chain ophalen of aanmaken
        const chainId = existingChainId ?? startChain();
        let chatHistory = getHistory(chainId);

        // Restart case: inject the old bot reply as synthetic AI context
        if (isRestartReply && referencedMsg) {
            chatHistory = syntheticHistory(referencedMsg.content);
        }

        // Reply-to-other-user + @mention: prepend that message as quoted context
        let fullQuestion = question;
        if (isMention && referencedMsg && !isReplyToBot) {
            const excerpt = referencedMsg.content.slice(0, 500);
            fullQuestion = `[Geciteerd bericht van @${referencedMsg.author.username}]: "${excerpt}"\n\n${question}`;
        }

        // Typing indicator, vernieuwd elke 8 seconden
        const sendTyping = () => void msg.channel.sendTyping();
        sendTyping();
        const typingInterval = setInterval(sendTyping, 8000);

        this.logger.info(
            `[AI] Vraag van ${msg.author.tag} in #${msg.channel.isTextBased() && 'name' in msg.channel ? msg.channel.name : msg.channelId}: "${question.slice(0, 80)}${question.length > 80 ? '…' : ''}"`,
        );
        const t0 = Date.now();

        const TOOL_STATUS: Record<string, string> = {
            zoek_opleiding_of_vak: '🔍 Opleiding of vak opzoeken...',
            haal_programma_op: '📋 Programma ophalen...',
            haal_curriculum_op: '📚 Curriculum ophalen...',
            haal_vakfiche_op: '📄 ECTS-fiche ophalen...',
        };

        // Statusbericht wordt lazy aangemaakt bij de eerste tool-call
        let statusMsg: Message<boolean> | undefined;
        let statusMsgPromise: Promise<Message<boolean>> | undefined;

        const getOrCreateStatusMsg = (): Promise<Message<boolean>> => {
            if (statusMsg) return Promise.resolve(statusMsg);
            if (statusMsgPromise) return statusMsgPromise;
            statusMsgPromise = msg.reply('⏳ Even geduld...').then((m) => {
                statusMsg = m;
                return m;
            });
            return statusMsgPromise;
        };

        try {
            const answer = await askAgent({
                question: fullQuestion,
                userId: msg.author.id,
                userRoles,
                serverName,
                chatHistory,
                onToolStart: (toolName) => {
                    const status = TOOL_STATUS[toolName] ?? `🔧 ${toolName}...`;
                    void getOrCreateStatusMsg().then((m) => m.edit(status));
                },
            });
            clearInterval(typingInterval);
            this.logger.info(`[AI] Antwoord klaar in ${Date.now() - t0}ms (${answer.length} tekens)`);

            // Verwijder statusbericht als het er is
            if (statusMsg) {
                try { await statusMsg.delete(); } catch { /* geen permissie → laat staan */ }
            }

            // Laatste chunk krijgt de disclaimer erbij — zorg dat die ook past
            const maxChunkLen = 2000 - DISCLAIMER.length - 2;
            const chunks = splitMessage(answer, maxChunkLen);
            const sentMessageIds: string[] = [];
            let lastMsg: Message<boolean> = msg;

            for (let i = 0; i < chunks.length; i++) {
                const isLast = i === chunks.length - 1;
                const content = isLast ? `${chunks[i]}\n\n${DISCLAIMER}` : chunks[i]!;
                // Pass the question only on the first chunk so it's quoted when the original message was deleted
                lastMsg = await safeReply(lastMsg, content, i === 0 ? question : undefined);
                sentMessageIds.push(lastMsg.id);
            }

            recordExchange({
                chainId,
                question: fullQuestion,
                answer,
                botMessageIds: sentMessageIds,
            });
        } catch (err) {
            clearInterval(typingInterval);
            this.logger.error(`[AI] Fout na ${Date.now() - t0}ms:`, err);
            const errText = 'Er is een fout opgetreden. Probeer het later opnieuw.\n' +
                'Bij dringende vragen: **trajectbegeleiding.bachelor.it@ap.be**';
            if (statusMsg) {
                await statusMsg.edit(errText);
            } else {
                await msg.reply(errText);
            }
        }
    }
}
