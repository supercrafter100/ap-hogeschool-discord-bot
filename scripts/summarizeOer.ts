// Summarize each OER section with a high-quality model. Run once (or whenever
// the OER PDF changes). Output: src/ai/data/oer-summary.json
//
// Run: npm run oer:summarize
//
// Env:
//   OPENAI_KEY / OPENAI_API_KEY  (required)
//   OPENAI_SUMMARY_MODEL         (default: gpt-5.5)

import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as dotenv } from 'dotenv';

dotenv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECTIONS_PATH = join(__dirname, '../src/ai/data/oer-sections.json');
const OUT_PATH = join(__dirname, '../src/ai/data/oer-summary.json');

interface OerSection {
    id: string;
    chapter: number;
    subsection?: number;
    title: string;
    text: string;
}

interface OerSummary {
    id: string;
    title: string;
    summary: string;
}

const MODEL = process.env.OPENAI_SUMMARY_MODEL ?? 'gpt-5.5';
const API_KEY = process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY;
if (!API_KEY) throw new Error('OPENAI_KEY of OPENAI_API_KEY ontbreekt in .env');

const client = new OpenAI({ apiKey: API_KEY });

const SYSTEM = `Je bent een juridische samenvatter voor het Onderwijs- en Examenreglement (OER) van AP Hogeschool Antwerpen.
Vat de volgende OER-sectie samen voor een AI-assistent die studentenvragen beantwoordt.

Eisen:
- Behoud ALLE concrete regels, termijnen, percentages, drempelwaarden, verplichtingen en uitzonderingen.
- Behoud verwijzingen naar andere artikels (bv. "art. 17.2") woordelijk.
- Schrijf in het Nederlands, in compacte zinnen, geen opsommingen tenzij de bron een lijst is.
- GEEN inleidende zinnen ("Deze sectie beschrijft..."), geen meta-opmerkingen.
- Doel: ~25–40% van de originele lengte. Korte secties (<400 tekens) mag je woordelijk overnemen.
- Geef alleen de samenvatting terug, geen titel, geen markdown headers.`;

async function summarize(section: OerSection): Promise<string> {
    // Very short sections aren't worth the API call.
    if (section.text.length < 400) return section.text;

    const res = await client.chat.completions.create({
        model: MODEL,
        messages: [
            { role: 'system', content: SYSTEM },
            {
                role: 'user',
                content: `Sectie ${section.id} — ${section.title}\n\n${section.text}`,
            },
        ],
        reasoning_effort: 'high',
        stream: false,
    } as Parameters<typeof client.chat.completions.create>[0]);

    // We don't stream, so res is a ChatCompletion. Cast through unknown for type narrow.
    const completion = res as unknown as { choices: { message: { content: string | null } }[] };
    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) throw new Error(`Geen samenvatting voor sectie ${section.id}`);
    return content;
}

async function main(): Promise<void> {
    if (!existsSync(SECTIONS_PATH)) {
        throw new Error(`Sections-bestand ontbreekt: ${SECTIONS_PATH}\nRun eerst: npm run oer:split`);
    }
    const sections: OerSection[] = JSON.parse(readFileSync(SECTIONS_PATH, 'utf8'));
    console.log(`Samenvatten van ${sections.length} secties met model "${MODEL}" (high reasoning)...`);

    // Resume support: keep partial progress if the process is interrupted.
    const existing: OerSummary[] = existsSync(OUT_PATH)
        ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
        : [];
    const done = new Set(existing.map((s) => s.id));
    const out: OerSummary[] = [...existing];

    let completed = done.size;
    let failed = 0;
    for (const sec of sections) {
        if (done.has(sec.id)) continue;
        const t0 = Date.now();
        try {
            const summary = await summarize(sec);
            out.push({ id: sec.id, title: sec.title, summary });
            completed += 1;
            console.log(
                `  [${completed}/${sections.length}] ${sec.id} ${sec.title.slice(0, 50)} ` +
                    `— ${sec.text.length} → ${summary.length} chars (${Date.now() - t0}ms)`,
            );
            // Write after each section so a crash doesn't lose work.
            writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
        } catch (err) {
            failed += 1;
            console.error(`  FOUT bij ${sec.id}:`, err instanceof Error ? err.message : err);
        }
    }

    // Sort by section id (numeric chapter, then numeric subsection) for stable output.
    out.sort((a, b) => {
        const [ac = 0, as = 0] = a.id.split('.').map(Number);
        const [bc = 0, bs = 0] = b.id.split('.').map(Number);
        return ac - bc || as - bs;
    });
    writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');

    const totalIn = sections.reduce((n, s) => n + s.text.length, 0);
    const totalOut = out.reduce((n, s) => n + s.summary.length, 0);
    console.log(
        `\nKlaar: ${completed} secties samengevat, ${failed} mislukt. ` +
            `${totalIn} → ${totalOut} chars (${Math.round((totalOut / totalIn) * 100)}%)`,
    );
    console.log('Geschreven naar', OUT_PATH);
}

main().catch((err) => {
    console.error('summarizeOer mislukt:', err);
    process.exit(1);
});
