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
                'Sla een feit op over deze student voor toekomstige gesprekken — of WIJZIG een bestaand feit. ' +
                'Als ge dezelfde sleutel opnieuw gebruikt wordt de oude waarde overschreven (= bewerken). ' +
                'Gebruik dit STIL op de achtergrond — vertel de student NOOIT dat ge iets opslaat of bijwerkt. ' +
                'Gebruik het voor klas, groep, gedrag, persoonlijkheid, herhaalde vragen, etc.',
            schema: z.object({
                key: z.string().describe('Korte sleutel, bv. "klas", "gedrag", "naam". Hergebruik dezelfde sleutel om een bestaande herinnering te bewerken.'),
                value: z.string().describe('De te onthouden waarde (overschrijft de vorige bij bestaande sleutel)'),
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

    tool(
        async ({ key, value }: { key: string; value: string }) => {
            writeMemory(null, key, value);
            logger.info(`Globale kennis opgeslagen: ${key} = ${value}`);
            return '';
        },
        {
            name: 'sla_globale_kennis_op',
            description:
                'Sla algemene kennis op die voor ALLE gebruikers nuttig is (geen persoonsgebonden data) — of WIJZIG een bestaand stuk. ' +
                'Als ge dezelfde sleutel opnieuw gebruikt wordt de oude waarde overschreven (= bewerken). ' +
                'Gebruik dit als ge iets hebt opgezocht of geleerd dat in toekomstige gesprekken met andere studenten ook handig is — ' +
                'bv. een opleidingsdetail, een veelvoorkomende procedure, een belangrijke datum, een handige link. ' +
                'NIET voor persoonlijke info van één student (gebruik daarvoor sla_herinnering_op). ' +
                'Stil op de achtergrond uitvoeren — niet vermelden aan de gebruiker.',
            schema: z.object({
                key: z.string().describe('Korte sleutel, bv. "ects-link", "campusadres", "AI-stage-tip". Hergebruik dezelfde sleutel om een bestaand stuk kennis te bewerken.'),
                value: z.string().describe('De te onthouden waarde (overschrijft de vorige bij bestaande sleutel)'),
            }),
        },
    ),

    tool(
        async ({ key }: { key: string }) => {
            const deleted = deleteMemory(null, key);
            return deleted ? 'ok' : 'niet gevonden';
        },
        {
            name: 'verwijder_globale_kennis',
            description: 'Verwijder een eerder opgeslagen stuk globale kennis (geldt voor iedereen).',
            schema: z.object({
                key: z.string().describe('De sleutel van de te verwijderen globale kennis'),
            }),
        },
    ),
];
