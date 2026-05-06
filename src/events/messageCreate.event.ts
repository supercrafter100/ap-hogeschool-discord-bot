import type { Message } from 'discord.js';
import { Event } from '../handler/EventHandler.js';
import { askAgent, DISCLAIMER } from '../ai/agent.js';
import {
    startChain,
    findChainByBotMessage,
    getHistory,
    recordExchange,
} from '../ai/history.js';

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

        // Controleer of dit een reply is op een botbericht uit een bestaande chain
        let existingChainId: string | undefined;
        if (msg.reference?.messageId) {
            existingChainId = findChainByBotMessage(msg.reference.messageId);
        }

        // Bij een chain-reply: alleen reageren als de bot ook effectief getagd is.
        // Als de gebruiker de mention-toggle uitgeschakeld heeft, staat de bot
        // niet in msg.mentions.users en negeren we het bericht.
        const botIsTagged = msg.mentions.users.has(botId);
        if (!isMention && (existingChainId === undefined || !botIsTagged)) return;

        // Haal de vraag op (strip mention prefix indien aanwezig)
        const question = isMention
            ? msg.content.slice(mentionPrefix.length).trim()
            : msg.content.trim();

        // Lege mention zonder vraag → beknopte help
        if (!question) {
            await msg.reply(
                'Hallo! Stel me een vraag over het OER of de ECTS-studiegids van AP Hogeschool.',
            );
            return;
        }

        // Haal Discord-rollen op (filter @everyone en generieke rollen)
        const userRoles =
            msg.member?.roles.cache
                .filter((r) => r.name !== '@everyone')
                .map((r) => r.name) ?? [];

        // Chain ophalen of aanmaken
        const chainId = existingChainId ?? startChain();
        const chatHistory = getHistory(chainId);

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
                question,
                userRoles,
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
                lastMsg = await lastMsg.reply(content);
                sentMessageIds.push(lastMsg.id);
            }

            recordExchange({
                chainId,
                question,
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
