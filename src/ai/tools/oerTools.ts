import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { findSectionById, searchSections } from '../oerData.js';
import Logger from '../../util/Logger.js';
import chalk from 'chalk';

const logger = new Logger();
logger.prefix = chalk.magenta('AI:tool');

export const oerTools = [
    tool(
        async ({ artikel, zoekterm }: { artikel?: string; zoekterm?: string }) => {
            if (!artikel && !zoekterm) {
                return 'Geef een artikelnummer (bv. "14.2") of een zoekterm op.';
            }

            if (artikel) {
                const id = artikel.trim().replace(/^art\.?\s*/i, '');
                logger.info(`OER-artikel ophalen: ${id}`);
                const sec = findSectionById(id);
                if (!sec) {
                    return `Geen OER-artikel gevonden met id "${id}". Bestaande artikels lopen van 1.1 t/m 23.8.`;
                }
                return `Art. ${sec.id} — ${sec.title}\n\n${sec.text}`;
            }

            const term = zoekterm!.trim();
            logger.info(`OER doorzoeken: "${term}"`);
            const hits = searchSections(term, 3);
            if (hits.length === 0) {
                return `Geen OER-artikels gevonden voor "${term}".`;
            }
            return hits
                .map((s) => `Art. ${s.id} — ${s.title}\n\n${s.text}`)
                .join('\n\n---\n\n');
        },
        {
            name: 'haal_oer_artikel_op',
            description:
                'Haalt de volledige tekst van een OER-artikel op. Gebruik dit voor exacte regels, termijnen, drempels of uitzonderingen. Geef OFWEL een artikelnummer (bv. "14.2") OFWEL een zoekterm.',
            schema: z.object({
                artikel: z
                    .string()
                    .optional()
                    .describe('Artikelnummer in het OER, bv. "14.2" of "23.6". Optioneel.'),
                zoekterm: z
                    .string()
                    .optional()
                    .describe(
                        'Zoekterm voor het geval je het artikelnummer niet kent (bv. "tolerantiekrediet"). Optioneel.',
                    ),
            }),
        },
    ),
];
