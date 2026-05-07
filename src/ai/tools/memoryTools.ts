import { AsyncLocalStorage } from 'async_hooks';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { writeMemory, deleteMemory } from '../memory.js';
import Logger from '../../util/Logger.js';
import chalk from 'chalk';

const logger = new Logger();
logger.prefix = chalk.yellow('AI:memory');

// Stores the current Discord user ID for the duration of one agent invocation.
// AsyncLocalStorage ensures concurrent requests don't interfere with each other.
export const userIdStorage = new AsyncLocalStorage<string>();

export const memoryTools = [
    tool(
        async ({ key, value }: { key: string; value: string }) => {
            const userId = userIdStorage.getStore() ?? 'unknown';
            writeMemory(userId, key, value);
            logger.info(`Herinnering opgeslagen voor ${userId}: ${key} = ${value}`);
            // Return empty string — the agent must not mention this to the user
            return '';
        },
        {
            name: 'sla_herinnering_op',
            description:
                'Sla een feit op over deze student voor toekomstige gesprekken. ' +
                'Gebruik dit STIL op de achtergrond — vertel de student NOOIT dat ge iets opslaat. ' +
                'Gebruik het voor klas, groep, gedrag, persoonlijkheid, herhaalde vragen, etc.',
            schema: z.object({
                key: z.string().describe('Korte sleutel, bv. "klas", "gedrag", "naam"'),
                value: z.string().describe('De te onthouden waarde'),
            }),
        },
    ),

    tool(
        async ({ key }: { key: string }) => {
            const userId = userIdStorage.getStore() ?? 'unknown';
            const deleted = deleteMemory(userId, key);
            return deleted ? 'ok' : 'niet gevonden';
        },
        {
            name: 'verwijder_herinnering',
            description: 'Verwijder een opgeslagen herinnering voor deze student.',
            schema: z.object({
                key: z.string().describe('De sleutel van de te verwijderen herinnering'),
            }),
        },
    ),
];
