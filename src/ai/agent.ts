import { ChatOpenAI } from '@langchain/openai';
import { createAgent } from 'langchain';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseMessage, MessageContent } from '@langchain/core/messages';
import type { ReactAgent } from 'langchain';
import { ectsTools } from './tools/ectsTools.js';
import { scheduleTools } from './tools/scheduleTools.js';
import { memoryTools, userIdStorage } from './tools/memoryTools.js';
import { oerTools } from './tools/oerTools.js';
import { formatMemoriesForContext } from './memory.js';
import { loadPromptTemplate } from './promptLoader.js';
import { renderSummaryForPrompt } from './oerData.js';
import { agentRequests, agentDuration, toolCalls, oerSummaryChars } from '../util/metrics.js';
import Logger from '../util/Logger.js';
import chalk from 'chalk';

export const DISCLAIMER =
    '-# Dit bericht is gegenereerd met AI en kan fouten bevatten, bij onduidelijkheid kun je altijd terecht bij trajectbegeleiding.bachelor.it@ap.be';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let agentInstance: ReactAgent<any> | null = null;

const logger = new Logger();
logger.prefix = chalk.magenta('AI');

function huidigAcademiejaar(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const startJaar = month >= 9 ? year : year - 1;
    return `${startJaar}-${(startJaar + 1).toString().slice(-2)}`;
}

export function initAgent(): void {
    const jaar = huidigAcademiejaar();
    const template = loadPromptTemplate();
    const summary = renderSummaryForPrompt();
    // Escape curly braces so LangChain template parsing doesn't choke on them.
    const safeSummary = summary.replace(/\{/g, '{{').replace(/\}/g, '}}');
    const systemText = template
        .replace('__OER_SUMMARY__', safeSummary)
        .replace('__HUIDIG_JAAR__', jaar);

    logger.info(
        `Agent initialiseren met model "${process.env.OPENAI_MODEL ?? 'gpt-4o-mini'}", ` +
            `academiejaar ${jaar}, prompt ${systemText.length} tekens (samenvatting ${summary.length} tekens).`,
    );
    oerSummaryChars.set(summary.length);

    const llm = new ChatOpenAI({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        apiKey: process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY,
    });

    agentInstance = createAgent({
        model: llm,
        tools: [...ectsTools, ...scheduleTools, ...memoryTools, ...oerTools],
        systemPrompt: new SystemMessage(systemText),
    });
    logger.info('Agent klaar.');
}

function messageContentToString(content: MessageContent): string {
    if (typeof content === 'string') return content;
    return content
        .filter(
            (c): c is { type: 'text'; text: string } =>
                typeof c === 'object' && c !== null && (c as { type: string }).type === 'text',
        )
        .map((c) => c.text)
        .join('');
}

export async function askAgent(params: {
    question: string;
    userId: string;
    userRoles: string[];
    serverName: string;
    chatHistory: BaseMessage[];
    onToolStart?: (toolName: string) => void;
}): Promise<string> {
    if (!agentInstance) throw new Error('Agent niet geïnitialiseerd. Roep initAgent() eerst aan.');

    const memories = formatMemoriesForContext(params.userId);
    const contextParts: string[] = [
        `Studentcontext (PRIVÉ — STILLE achtergrond, NOOIT vermelden in je antwoord):`,
        `- Discord-server = "${params.serverName}". De servernaam kan een hint geven over de opleiding (bv. "G_Prog" → Graduaat Programmeren, "grad-snb" → Graduaat Systeem- en Netwerkbeheer).`,
        `- Discord-rollen = ${params.userRoles.length ? params.userRoles.join(', ') : '(geen rollen of niet-hoofdserver)'}.`,
        `Leid de opleiding en het traject af uit rollen EN servernaam (combineer ze, of gebruik servernaam als rollen ontbreken). NOOIT vermelden in je antwoord: niet de rollen letterlijk, niet de servernaam, niet de afgeleide opleiding/richting/jaar (bv. "ge zit in 2e jaar AI"), niet "volgens je rollen" of "op deze server". Gebruik de info enkel om je antwoord aan te passen.`,
    ];
    if (memories) contextParts.push(`Opgeslagen herinneringen voor deze student:\n${memories}`);

    const roleMessage: BaseMessage[] = [new SystemMessage(contextParts.join('\n'))];

    const allMessages: BaseMessage[] = [
        ...params.chatHistory,
        ...roleMessage,
        new HumanMessage(params.question),
    ];

    logger.info(`Vraag verwerken (history: ${params.chatHistory.length} berichten, rollen: ${params.userRoles.join(', ') || 'geen'})`);
    const t0 = Date.now();
    const endTimer = agentDuration.startTimer();

    const invokeConfig = {
        recursionLimit: 20,
        callbacks: [{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            handleToolStart(_tool: any, _input: string, _runId: string, _parentRunId?: string, _tags?: string[], _metadata?: unknown, name?: string) {
                const toolName = name ?? 'tool';
                toolCalls.inc({ tool: toolName });
                params.onToolStart?.(toolName);
            },
        }],
    };

    try {
        const result = await userIdStorage.run(params.userId, () =>
            agentInstance!.invoke({ messages: allMessages }, invokeConfig),
        );

        const msgs = result.messages as BaseMessage[];
        logger.info(`Klaar in ${Date.now() - t0}ms (${msgs.length} berichten in result, incl. tool calls)`);

        agentRequests.inc({ outcome: 'success' });
        endTimer();

        const lastMsg = msgs[msgs.length - 1];
        if (!lastMsg) return 'Geen antwoord ontvangen.';

        return messageContentToString(lastMsg.content);
    } catch (err) {
        agentRequests.inc({ outcome: 'error' });
        endTimer();
        throw err;
    }
}
