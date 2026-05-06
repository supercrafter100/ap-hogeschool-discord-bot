/* eslint-disable @typescript-eslint/no-explicit-any */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as ects from '../api/ectsClient.js';
import type { OlodFiche, LegacyOlodFiche, ModernOlodFiche, Traject, DeelTraject, OptionalCourseBlock } from '../types/ects.js';
import Logger from '../../util/Logger.js';
import chalk from 'chalk';

const logger = new Logger();
logger.prefix = chalk.magenta('AI:tool');

function huidigAcademiejaar(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const startJaar = month >= 9 ? year : year - 1;
    return `${startJaar}-${(startJaar + 1).toString().slice(-2)}`;
}

function stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// --- OlodFiche format detection & rendering ---

function isModernFiche(fiche: OlodFiche): fiche is ModernOlodFiche {
    return 'course' in fiche && fiche.course !== null && typeof fiche.course === 'object';
}

function olodModernToText(fiche: ModernOlodFiche): string {
    const c = fiche.course;
    const lines: string[] = [
        `Vak: ${c.name}`,
        `Academiejaar: ${c.academicYear}`,
        `Studiepunten: ${c.credits}`,
    ];

    const titularis = c.instructors.find((i) => i.role === 'Titularis');
    if (titularis) lines.push(`Titularis: ${titularis.name}`);
    const overige = c.instructors.filter((i) => i.role !== 'Titularis').map((i) => i.name);
    if (overige.length) lines.push(`Andere docenten: ${overige.join(', ')}`);

    lines.push(`Onderwijstaal: ${c.language}`);
    if (c.specialization) lines.push(`Afstudeerrichting: ${c.specialization}`);
    lines.push(`Omschrijving: ${fiche.description}`);

    if (fiche.learningOutcomes.length) {
        lines.push(`Leerdoelen: ${fiche.learningOutcomes.join('; ')}`);
    }
    if (fiche.content.length) {
        lines.push(`Leerinhoud: ${fiche.content.join(', ')}`);
    }

    const assessmentParts = Object.entries(fiche.assessment)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`);
    if (assessmentParts.length) lines.push(`Toetsing: ${assessmentParts.join(', ')}`);

    if (fiche.prerequisites && fiche.prerequisites !== 'None') {
        lines.push(`Volgtijdelijkheid: ${fiche.prerequisites}`);
    }

    return lines.join('\n');
}

function olodLegacyToText(fiche: LegacyOlodFiche): string {
    const lines: string[] = [];

    for (const block of fiche.ectsBlocks) {
        for (const comp of block.components) {
            const c = comp.content as Record<string, any>;

            switch (comp.name) {
                case 'comp_olod_name':
                    lines.push(`Vak: ${String(c['text'] ?? '')}`);
                    break;
                case 'comp_academic_year':
                    lines.push(`Academiejaar: ${String(c['text'] ?? '')}`);
                    break;
                case 'comp_course_weight':
                    lines.push(`Studiepunten: ${String(c['studiepunten'] ?? '')}`);
                    break;
                case 'comp_olod_info': {
                    const lectoren = (c['docenten'] as any)?.lectoren as Array<any> | undefined;
                    if (lectoren) {
                        const titularis = lectoren.find((l: any) => l.isTitularis);
                        if (titularis) lines.push(`Titularis: ${String(titularis.roepnaam)} ${String(titularis.naam)}`);
                        const overige = lectoren
                            .filter((l: any) => !l.isTitularis)
                            .map((l: any) => `${String(l.roepnaam)} ${String(l.naam)}`);
                        if (overige.length) lines.push(`Andere docenten: ${overige.join(', ')}`);
                    }
                    const talen = c['onderwijsTalen'] as string[] | undefined;
                    if (talen) lines.push(`Onderwijstaal: ${talen.join(', ')}`);
                    const kalender = c['kalenderItems'] as string[] | undefined;
                    if (kalender) lines.push(`Periode: ${kalender.join(', ')}`);
                    break;
                }
                case 'comp_description':
                    lines.push(`Omschrijving: ${stripHtml(String(c['text'] ?? ''))}`);
                    break;
                case 'comp_competences': {
                    const comps = c['competenties'] as Array<{ category: string; elements: string[] }> | undefined;
                    if (comps) {
                        for (const cat of comps) {
                            lines.push(`Leerdoelen (${cat.category}): ${cat.elements.join('; ')}`);
                        }
                    }
                    break;
                }
                case 'comp_learning_content':
                    lines.push(`Leerinhoud: ${stripHtml(String(c['text'] ?? ''))}`);
                    break;
                case 'comp_courses_info': {
                    // Keuzeopties (richting waartoe dit vak behoort)
                    const opleidingen = c['opleidingen'] as Array<any> | undefined;
                    if (opleidingen) {
                        const keuzeopties = opleidingen
                            .flatMap((o: any) => (o.keuzeopties as string[] | undefined) ?? [])
                            .filter((v, i, a) => a.indexOf(v) === i);
                        if (keuzeopties.length) lines.push(`Keuzeoptie/richting: ${keuzeopties.join(', ')}`);
                    }
                    break;
                }
                case 'comp_exam_policy':
                    lines.push(`Examenbeleid: ${stripHtml(String(c['text'] ?? ''))}`);
                    break;
                case 'comp_evaluation_list': {
                    const evalGroepen = c['evaluatievormen'] as Array<any> | undefined;
                    if (evalGroepen) {
                        // Toon alle evaluatieonderdelen behalve de 2e kans (examenkans 2)
                        const alle = evalGroepen
                            .flatMap((g: any) => (g.evaluatievormen as Array<any>).filter((e: any) => e.examenkans !== 2))
                            .map((e: any) => `${String(e.vormAfkorting)} ${String(e.procent)}% (${String(e.momentAfkorting)})`);
                        if (alle.length) lines.push(`Toetsing: ${alle.join(', ')}`);

                        const tweedeKans = evalGroepen
                            .flatMap((g: any) => (g.evaluatievormen as Array<any>).filter((e: any) => e.examenkans === 2))
                            .map((e: any) => `${String(e.vormAfkorting)} ${String(e.procent)}%`);
                        if (tweedeKans.length) lines.push(`Toetsing 2e kans: ${tweedeKans.join(', ')}`);
                    }
                    break;
                }
                case 'comp_evaluation':
                    // Vrije tekst bij toetsing — bevat aanwezigheidsregels, portfolio-info, etc.
                    if (c['text']) lines.push(`Toetsing (extra info): ${stripHtml(String(c['text']))}`);
                    break;
                case 'comp_teaching_methods': {
                    const methods = c['teachingMethods'] as Array<any> | undefined;
                    if (methods) {
                        const uren = methods
                            .flatMap((m: any) => (m.elements as Array<any> | undefined) ?? [])
                            .filter((e: any) => e.numberOfHours && parseFloat(e.numberOfHours) > 0)
                            .map((e: any) => `${String(e.name)}: ${String(e.numberOfHours)}u`);
                        if (uren.length) lines.push(`Onderwijsorganisatie: ${uren.join(', ')}`);
                    }
                    break;
                }
                case 'comp_prerequisites':
                    lines.push(`Volgtijdelijkheid: ${stripHtml(String(c['text'] ?? ''))}`);
                    break;
            }
        }
    }

    return lines.join('\n');
}

function olodFicheToText(fiche: OlodFiche): string {
    return isModernFiche(fiche) ? olodModernToText(fiche) : olodLegacyToText(fiche);
}

// --- Traject rendering (handles old & new format) ---

function trajectToText(traject: Traject): string {
    const naam = traject.naam ?? traject.trajectNaam ?? 'Traject';
    const lines: string[] = [`Traject: ${naam}`];
    if (traject.opleidingNaam) lines.push(`Opleiding: ${traject.opleidingNaam}`);

    const procesOptionalBlock = (block: OptionalCourseBlock, indent = '    ') => {
        lines.push(`${indent}Keuzeblok: ${block.title}${block.description ? ` — ${block.description}` : ''}`);
        for (const c of block.courses) {
            lines.push(`${indent}  - ${c.naam} (${c.studiepunten} SP, id: ${c.url})`);
        }
        for (const sub of block.subBlocks ?? []) {
            procesOptionalBlock(sub, indent + '  ');
        }
    };

    const procesDeelTraject = (dt: DeelTraject) => {
        const dtNaam = dt.naam ?? dt.title ?? 'Onderdeel';
        lines.push(`\n  ${dtNaam}${dt.studiepunten !== undefined ? ` (${dt.studiepunten} SP)` : ''}`);

        // Old format: opleidingsonderdelen
        for (const olod of dt.opleidingsonderdelen ?? []) {
            const id = olod.id ?? olod.url ?? '?';
            lines.push(`    - ${olod.naam} (${olod.studiepunten} SP, id: ${id})`);
        }
        // New format: verplichte vakken
        for (const c of dt.courses ?? []) {
            lines.push(`    - ${c.naam} (${c.studiepunten} SP, id: ${c.url})`);
        }
        // Keuzeblokken (nieuw formaat, bv. CSC / IoT richtingen)
        for (const block of dt.optionalCourseBlocks ?? []) {
            procesOptionalBlock(block);
        }
        // Keuzegroepen (oud formaat)
        for (const kg of dt.keuzegroepen ?? []) {
            lines.push(`    Keuzegroep: ${kg.naam}`);
            for (const olod of kg.opleidingsonderdelen ?? []) {
                const id = olod.id ?? olod.url ?? '?';
                lines.push(`      - ${olod.naam} (${olod.studiepunten} SP, id: ${id})`);
            }
        }
    };

    for (const dt of traject.deelTrajecten ?? []) procesDeelTraject(dt);
    for (const olod of traject.opleidingsonderdelen ?? []) {
        lines.push(`  - ${olod.naam} (${olod.studiepunten} SP, id: ${olod.id ?? olod.url ?? '?'})`);
    }

    return lines.join('\n');
}

// --- Tools ---

export const ectsTools = [
    tool(
        async ({ zoekterm, jaar }: { zoekterm: string; jaar?: string }) => {
            const j = jaar ?? huidigAcademiejaar();
            const t0 = Date.now();
            logger.info(`zoek_opleiding_of_vak("${zoekterm}", "${j}")`);
            try {
                // Zoek ook de alternatieve spelling (met/zonder koppelteken)
                const alternatief = zoekterm.includes('-')
                    ? zoekterm.replace(/-/g, ' ')
                    : zoekterm.replace(/ /g, '-');
                const termen = zoekterm === alternatief ? [zoekterm] : [zoekterm, alternatief];
                const results = await Promise.all(termen.map((t) => ects.zoek(j, t)));
                const result = results[0]!;
                if (result.errorOccured) return 'ECTS-zoekopdracht mislukt.';
                if (result.invalidInput) return 'Ongeldige zoekopdracht.';

                // Merge resultaten en dedupliceer op id
                const extraResults = results.slice(1);
                for (const r of extraResults) {
                    for (const groep of r.opleidingsonderdelen) {
                        const bestaand = result.opleidingsonderdelen.find(
                            (g) => g.opleiding.url === groep.opleiding.url,
                        );
                        if (bestaand) {
                            for (const c of groep.courses) {
                                if (!bestaand.courses.some((bc) => bc.url === c.url)) {
                                    bestaand.courses.push(c);
                                }
                            }
                        } else {
                            result.opleidingsonderdelen.push(groep);
                        }
                    }
                    for (const opl of r.opleidingen) {
                        if (!result.opleidingen.some((o) => o.url === opl.url)) {
                            result.opleidingen.push(opl);
                        }
                    }
                }

                const lines: string[] = [];
                for (const opl of result.opleidingen) {
                    lines.push(`Opleiding: "${opl.naam}" (url: ${opl.url}) — ${ects.getPubliekeOpleidingUrl(j, opl.url)}`);
                }
                for (const groep of result.opleidingsonderdelen) {
                    for (const course of groep.courses) {
                        lines.push(`Vak: "${course.naam}" (id: ${course.url}, opleiding: ${groep.opleiding.naam}) — ${ects.getPubliekeOlodUrl(course.url)}`);
                    }
                }
                const output = lines.length > 0 ? lines.join('\n') : 'Geen resultaten gevonden.';
                logger.info(`zoek_opleiding_of_vak klaar (${Date.now() - t0}ms, ${lines.length} resultaten)`);
                return output;
            } catch (e) {
                logger.info(`zoek_opleiding_of_vak fout (${Date.now() - t0}ms): ${String(e)}`);
                return `Fout bij zoeken: ${String(e)}`;
            }
        },
        {
            name: 'zoek_opleiding_of_vak',
            description: 'Zoek een opleiding of opleidingsonderdeel (vak) op naam in de ECTS-studiegids. Geeft namen, url-codes en directe links terug.',
            schema: z.object({
                zoekterm: z.string().describe('De naam van de opleiding of het vak'),
                jaar: z.string().optional().describe('Academiejaar, bv. "2025-26". Standaard het huidige jaar.'),
            }),
        },
    ),

    tool(
        async ({ programmaUrl, jaar }: { programmaUrl: string; jaar?: string }) => {
            const j = jaar ?? huidigAcademiejaar();
            const t0 = Date.now();
            logger.info(`haal_programma_op("${programmaUrl}", "${j}")`);
            try {
                const detail = await ects.getProgramma(j, programmaUrl);
                const publiekUrl = ects.getPubliekeOpleidingUrl(j, programmaUrl);
                const lines: string[] = [
                    `Opleiding: ${detail.opleidingNaam}`,
                    `Publieke link: ${publiekUrl}`,
                    'Beschikbare trajecten:',
                ];
                for (const cat of detail.data) {
                    if (cat.categorie) lines.push(`  [${cat.categorie}]`);
                    for (const traj of cat.level2Elements) {
                        lines.push(`    - "${traj.naam}" (trajectId: ${traj.url}) — ${ects.getPubliekeTrajectUrl(j, programmaUrl, traj.url)}`);
                    }
                }
                logger.info(`haal_programma_op klaar (${Date.now() - t0}ms)`);
                return lines.join('\n');
            } catch (e) {
                logger.info(`haal_programma_op fout (${Date.now() - t0}ms): ${String(e)}`);
                return `Fout bij ophalen programma: ${String(e)}`;
            }
        },
        {
            name: 'haal_programma_op',
            description: 'Haal de beschikbare trajecten/varianten op voor een opleiding. Gebruik de url-code uit zoek_opleiding_of_vak (bv. "PBA-TI").',
            schema: z.object({
                programmaUrl: z.string().describe('Url-code van de opleiding, bv. "PBA-TI"'),
                jaar: z.string().optional().describe('Academiejaar, bv. "2025-26".'),
            }),
        },
    ),

    tool(
        async ({ programmaUrl, trajectId, jaar }: { programmaUrl: string; trajectId: string; jaar?: string }) => {
            const j = jaar ?? huidigAcademiejaar();
            const t0 = Date.now();
            logger.info(`haal_curriculum_op("${programmaUrl}", trajectId="${trajectId}", "${j}")`);
            try {
                const traject = await ects.getTraject(j, programmaUrl, trajectId);
                const publiekUrl = ects.getPubliekeTrajectUrl(j, programmaUrl, trajectId);
                logger.info(`haal_curriculum_op klaar (${Date.now() - t0}ms)`);
                return trajectToText(traject) + `\n\nBron: ${publiekUrl}`;
            } catch (e) {
                logger.info(`haal_curriculum_op fout (${Date.now() - t0}ms): ${String(e)}`);
                return `Fout bij ophalen curriculum: ${String(e)}`;
            }
        },
        {
            name: 'haal_curriculum_op',
            description: 'Haal het vakkenoverzicht op voor een traject. Gebruik de trajectId uit haal_programma_op.',
            schema: z.object({
                programmaUrl: z.string().describe('Url-code van de opleiding, bv. "PBA-TI"'),
                trajectId: z.string().describe('Id van het traject uit haal_programma_op, bv. "10066"'),
                jaar: z.string().optional().describe('Academiejaar, bv. "2025-26".'),
            }),
        },
    ),

    tool(
        async ({ olodId }: { olodId: number }) => {
            const t0 = Date.now();
            logger.info(`haal_vakfiche_op(olodId=${olodId})`);
            try {
                const fiche = await ects.getOpleidingsonderdeel(olodId);
                const publiekUrl = ects.getPubliekeOlodUrl(olodId);
                logger.info(`haal_vakfiche_op klaar (${Date.now() - t0}ms)`);
                return olodFicheToText(fiche) + `\n\nBron: ${publiekUrl}`;
            } catch (e) {
                logger.info(`haal_vakfiche_op fout (${Date.now() - t0}ms): ${String(e)}`);
                return `Fout bij ophalen vakfiche: ${String(e)}`;
            }
        },
        {
            name: 'haal_vakfiche_op',
            description: 'Haal de volledige ECTS-fiche op van één vak: omschrijving, leerdoelen, toetsing, docenten. Gebruik het numerieke id of url-waarde uit haal_curriculum_op.',
            schema: z.object({
                olodId: z.number().describe('Numeriek id van het vak (staat als "id" of "url" in het curriculum)'),
            }),
        },
    ),
];
