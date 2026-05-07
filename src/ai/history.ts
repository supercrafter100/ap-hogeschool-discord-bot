import { randomUUID } from 'crypto';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';

interface Chain {
    id: string;
    messages: BaseMessage[];
    lastActivity: Date;
    botMessageIds: Set<string>;
}

const chains = new Map<string, Chain>();
const chainByBotMessageId = new Map<string, string>();

const CHAIN_TTL_MS = 2 * 60 * 60 * 1000; // 2 uur
const MAX_HISTORY_MESSAGES = 20; // max berichten in history om context-grootte te beperken

export function startChain(): string {
    const id = randomUUID();
    chains.set(id, {
        id,
        messages: [],
        lastActivity: new Date(),
        botMessageIds: new Set(),
    });
    return id;
}

export function findChainByBotMessage(botMessageId: string): string | undefined {
    return chainByBotMessageId.get(botMessageId);
}

export function getHistory(chainId: string): BaseMessage[] {
    const messages = chains.get(chainId)?.messages ?? [];
    // Begrens history om token-overflow te vermijden
    return messages.slice(-MAX_HISTORY_MESSAGES);
}

/** Build a one-message synthetic history from a previous bot reply (e.g. after restart). */
export function syntheticHistory(botResponse: string): BaseMessage[] {
    return [new AIMessage(botResponse)];
}

export function recordExchange(params: {
    chainId: string;
    question: string;
    answer: string;
    botMessageIds: string[];
}): void {
    const chain = chains.get(params.chainId);
    if (!chain) return;

    chain.messages.push(new HumanMessage(params.question));
    chain.messages.push(new AIMessage(params.answer));
    chain.lastActivity = new Date();

    for (const id of params.botMessageIds) {
        chain.botMessageIds.add(id);
        chainByBotMessageId.set(id, params.chainId);
    }
}

// Verwijder chains ouder dan TTL
setInterval(
    () => {
        const now = Date.now();
        for (const [id, chain] of chains) {
            if (now - chain.lastActivity.getTime() > CHAIN_TTL_MS) {
                for (const botMsgId of chain.botMessageIds) {
                    chainByBotMessageId.delete(botMsgId);
                }
                chains.delete(id);
            }
        }
    },
    30 * 60 * 1000,
).unref();
