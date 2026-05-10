import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECTIONS_PATH = join(__dirname, 'data/oer-sections.json');
const SUMMARY_PATH = join(__dirname, 'data/oer-summary.json');

export interface OerSection {
    id: string;
    chapter: number;
    subsection?: number;
    title: string;
    text: string;
}

export interface OerSummary {
    id: string;
    title: string;
    summary: string;
}

let sectionsCache: OerSection[] | null = null;
let summaryCache: OerSummary[] | null = null;

export function loadSections(): OerSection[] {
    if (!sectionsCache) {
        sectionsCache = JSON.parse(readFileSync(SECTIONS_PATH, 'utf8')) as OerSection[];
    }
    return sectionsCache;
}

export function loadSummary(): OerSummary[] {
    if (!summaryCache) {
        summaryCache = JSON.parse(readFileSync(SUMMARY_PATH, 'utf8')) as OerSummary[];
    }
    return summaryCache;
}

export function findSectionById(id: string): OerSection | undefined {
    return loadSections().find((s) => s.id === id);
}

export function searchSections(term: string, limit = 5): OerSection[] {
    const needle = term.toLowerCase();
    const sections = loadSections();
    const scored = sections
        .map((s) => {
            const titleHit = s.title.toLowerCase().includes(needle) ? 10 : 0;
            const bodyMatches = (s.text.toLowerCase().match(new RegExp(escapeRe(needle), 'g')) ?? []).length;
            return { s, score: titleHit + bodyMatches };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((x) => x.s);
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Render the summary as a plain-text block for embedding in the system prompt.
 */
export function renderSummaryForPrompt(): string {
    const summary = loadSummary();
    return summary
        .map((s) => `Art. ${s.id} — ${s.title}\n${s.summary}`)
        .join('\n\n');
}
