import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { findClassIds, getClasses, getWeeklyTimetable, formatTimetable } from '../api/webuntisClient.js';
import Logger from '../../util/Logger.js';
import chalk from 'chalk';

const logger = new Logger();
logger.prefix = chalk.cyan('AI:schedule');

function currentMonday(): string {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().split('T')[0]!;
}

export const scheduleTools = [
    tool(
        async ({ zoekterm }: { zoekterm?: string }) => {
            logger.info(`zoek_it_klassen(zoekterm=${zoekterm ?? '*'})`);
            try {
                const all = await getClasses();
                const itClasses = all.filter((c) => c.name.includes('IT'));
                const filtered = zoekterm
                    ? itClasses.filter((c) =>
                          c.name.toLowerCase().includes(zoekterm.toLowerCase()) ||
                          (c.longName ?? '').toLowerCase().includes(zoekterm.toLowerCase()),
                      )
                    : itClasses;
                if (filtered.length === 0) return 'Geen IT-klassen gevonden.';
                return filtered.map((c) => `${c.name} (id: ${c.id}) — ${c.longName ?? ''}`).join('\n');
            } catch (e) {
                return `Fout: ${String(e)}`;
            }
        },
        {
            name: 'zoek_it_klassen',
            description:
                'Geeft een lijst van alle beschikbare IT-klassen in WebUntis (klassen die "IT" bevatten in hun naam). ' +
                'Gebruik dit om te weten welke klassen bestaan voordat je haal_rooster_op aanroept.',
            schema: z.object({
                zoekterm: z
                    .string()
                    .optional()
                    .describe('Optionele filter, bv. "AI" of "VT" of "1IT". Leeg = alle IT-klassen.'),
            }),
        },
    ),

    tool(
        async ({
            jaar,
            richting,
            groep,
            datum,
        }: {
            jaar: number;
            richting: string;
            groep?: number;
            datum?: string;
        }) => {
            const date = datum ?? currentMonday();
            logger.info(`haal_rooster_op(jaar=${jaar}, richting=${richting}, groep=${groep ?? '?'}, datum=${date})`);

            try {
                const classes = await findClassIds(jaar, richting, groep);

                if (classes.length === 0) {
                    return `Geen klassen gevonden voor jaar ${jaar} ${richting.toUpperCase()}${groep ? ` groep ${groep}` : ''}. Controleer of de richting en het jaar kloppen.`;
                }

                if (classes.length > 1 && groep === undefined) {
                    const names = classes.map((c) => c.name).join(', ');
                    return (
                        `Er zijn ${classes.length} groepen voor ${jaar} ${richting.toUpperCase()}: **${names}**.\n` +
                        `Vraag de student welke groep ze volgen (het getal achteraan hun klasnaam, bv. groep 1 = ${classes[0]?.name}).`
                    );
                }

                // Fetch timetable for each class (usually 1, max 2–3)
                const results = await Promise.all(
                    classes.map(async (c) => {
                        const data = await getWeeklyTimetable(c.id, date);
                        return formatTimetable(c.name, c.id, data);
                    }),
                );

                logger.info(`haal_rooster_op klaar (${classes.length} klassen)`);
                return results.join('\n\n---\n\n');
            } catch (e) {
                logger.error('haal_rooster_op fout:', e as Error);
                return `Fout bij ophalen rooster: ${String(e)}`;
            }
        },
        {
            name: 'haal_rooster_op',
            description:
                'Haal het weekrooster op van een klas via WebUntis. ' +
                'Gebruik het jaar (1, 2 of 3) en de richting (AI, SOF, CSC, IOT of MR). ' +
                'Als er meerdere groepen zijn en de groep is niet gespecificeerd, vraag dan aan de student welke groep ze volgen.',
            schema: z.object({
                jaar: z.number().int().min(1).max(3).describe('Jaar: 1, 2 of 3'),
                richting: z
                    .string()
                    .describe('Richting: VTAI, AI, SOF, CSC, IOT of MR (Immersive Technologies)'),
                groep: z
                    .number()
                    .int()
                    .optional()
                    .describe('Groepsnummer (bv. 1, 2, 3). Weglaten als onbekend.'),
                datum: z
                    .string()
                    .optional()
                    .describe('Datum in YYYY-MM-DD formaat binnen de gewenste week. Standaard = huidige week.'),
            }),
        },
    ),
];
