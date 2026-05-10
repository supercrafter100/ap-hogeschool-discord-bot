// Split the OER PDF into hierarchical sections using pdfjs-dist with font/size info.
// Output: src/ai/data/oer-sections.json
//
// Run: npm run oer:split
//
// Heading detection (PDF uses two bold variants on the same font ID):
//   - Chapter title:  font=g_d0_f1 (bold) + height ≈ 14   →  "1 Begripsbepaling"
//   - Sub-section:    font=g_d0_f1 (bold) + height ≈ 13   →  "Verzekeringen"
//   - Bold inline:    font=g_d0_f1 (bold) + height ≈ 10   →  paragraph emphasis (NOT a heading)
//   - Body:           font=g_d0_f2 + height 10            →  paragraph text
// Sub-sections are unnumbered in the PDF body — we assign N.M by counting within each chapter.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = join(__dirname, '../OER_25-26_Dep-29.08.2025.pdf');
const OUT_PATH = join(__dirname, '../src/ai/data/oer-sections.json');

interface PdfTextItem {
    str: string;
    transform: number[];
    fontName: string;
    height: number;
    width: number;
    hasEOL: boolean;
}

export interface OerSection {
    id: string;
    chapter: number;
    subsection?: number;
    title: string;
    text: string;
}

const CHAPTER_HEIGHT_MIN = 13.5;
const SUBHEADING_HEIGHT_MIN = 12.5;
const SUBHEADING_HEIGHT_MAX = 13.5;
const BOLD_FONT_SUFFIX = '_f1';

function isBold(item: PdfTextItem): boolean {
    return item.fontName.endsWith(BOLD_FONT_SUFFIX);
}

function isPageHeader(item: PdfTextItem): boolean {
    // Page header runs at y ≈ 37 (top of page, decorative).
    const y = item.transform[5];
    return y !== undefined && y < 50;
}

interface Line {
    items: PdfTextItem[];
    text: string;
    /** Max height across items on this line — used to classify heading level. */
    maxHeight: number;
    /** True if every non-whitespace item on this line is bold. */
    allBold: boolean;
    y: number;
    page: number;
}

function groupItemsIntoLines(items: PdfTextItem[], page: number): Line[] {
    // Group by y coordinate (small tolerance for jitter).
    const lines: Line[] = [];
    const Y_TOL = 1.5;
    for (const it of items) {
        if (isPageHeader(it)) continue;
        const y = it.transform[5];
        if (y === undefined) continue;
        let line = lines.find((l) => Math.abs(l.y - y) < Y_TOL);
        if (!line) {
            line = { items: [], text: '', maxHeight: 0, allBold: true, y, page };
            lines.push(line);
        }
        line.items.push(it);
    }
    // Build text + classify each line.
    for (const l of lines) {
        l.items.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0));
        l.text = l.items.map((i) => i.str).join('').replace(/\s+/g, ' ').trim();
        l.maxHeight = Math.max(...l.items.map((i) => i.height || 0));
        l.allBold = l.items.every((i) => !i.str.trim() || isBold(i));
    }
    // Sort top-to-bottom (PDF y is bottom-up, so descending y = top-to-bottom on page).
    lines.sort((a, b) => b.y - a.y);
    return lines;
}

function isChapterHeading(line: Line): { num: number; title: string } | null {
    if (!line.allBold) return null;
    if (line.maxHeight < CHAPTER_HEIGHT_MIN) return null;
    // Chapter heading: "N Title" — number is its own item but joined into line.text.
    const m = line.text.match(/^(\d{1,2})\s+(.{2,}?)$/);
    if (!m || m[1] === undefined || m[2] === undefined) return null;
    const num = parseInt(m[1], 10);
    if (num < 1 || num > 30) return null;
    return { num, title: m[2].trim() };
}

function isSubHeading(line: Line): string | null {
    if (!line.allBold) return null;
    if (line.maxHeight < SUBHEADING_HEIGHT_MIN || line.maxHeight > SUBHEADING_HEIGHT_MAX) return null;
    const t = line.text.trim();
    if (!t || t.length < 3) return null;
    // Reject lines that look like a chapter heading (those are caught by isChapterHeading).
    if (/^\d{1,2}\s/.test(t)) return null;
    return t;
}

// Headings that are document-level appendices (after the last numbered chapter).
// These shouldn't be folded into the previous chapter as a fake sub-section.
const APPENDIX_HEADINGS = new Set(['Bijlagen']);

async function main(): Promise<void> {
    console.log('Reading PDF:', PDF_PATH);
    const data = new Uint8Array(readFileSync(PDF_PATH));
    const doc = await getDocument({ data, disableFontFace: true, useSystemFonts: false }).promise;
    console.log(`Pages: ${doc.numPages}`);

    // Collect all body lines across all pages, in reading order.
    const allLines: Line[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const lines = groupItemsIntoLines(tc.items as PdfTextItem[], p);
        allLines.push(...lines);
    }

    // Skip the TOC: it ends right before the first chapter-heading line in the body.
    // The TOC has chapter numbers as separate items, but they appear with smaller height
    // (TOC entries use height ≈ 10–14) AND with dot-leaders ("....."). We detect the body
    // start by the first chapter heading whose text contains no dot-leader.
    let bodyStart = -1;
    for (let i = 0; i < allLines.length; i++) {
        const l = allLines[i]!;
        const ch = isChapterHeading(l);
        if (!ch) continue;
        if (l.text.includes('....')) continue; // TOC entry
        if (ch.num !== 1) continue;
        bodyStart = i;
        break;
    }
    if (bodyStart === -1) throw new Error('Could not locate body start (chapter 1).');
    console.log(`Body starts at line index ${bodyStart} of ${allLines.length}.`);

    const sections: OerSection[] = [];
    let curChapter: { num: number; title: string } | null = null;
    let curSub: { num: number; title: string } | null = null;
    let buf: string[] = [];

    const flush = (): void => {
        if (!curChapter) return;
        const text = buf.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        if (!text && !curSub) {
            buf = [];
            return;
        }
        const id = curSub ? `${curChapter.num}.${curSub.num}` : `${curChapter.num}`;
        const title = curSub ? curSub.title : curChapter.title;
        sections.push({
            id,
            chapter: curChapter.num,
            ...(curSub ? { subsection: curSub.num } : {}),
            title,
            text,
        });
        buf = [];
    };

    let subCounter = 0;
    for (let i = bodyStart; i < allLines.length; i++) {
        const l = allLines[i]!;

        const ch = isChapterHeading(l);
        if (ch) {
            flush();
            curChapter = ch;
            curSub = null;
            subCounter = 0;
            continue;
        }

        const sub = isSubHeading(l);
        if (sub && curChapter) {
            // Document-level appendices (e.g. "Bijlagen") are not part of any chapter.
            // Stop processing — anything after them is non-regulatory tail content.
            if (APPENDIX_HEADINGS.has(sub)) {
                flush();
                curChapter = null;
                curSub = null;
                break;
            }
            flush();
            subCounter += 1;
            // Greedy: merge consecutive sub-heading lines (the PDF wraps long titles
            // across multiple bold-13pt lines that all qualify as sub-headings).
            const titleParts = [sub];
            let j = i + 1;
            while (j < allLines.length) {
                const next = allLines[j]!;
                if (isChapterHeading(next)) break;
                const nextSub = isSubHeading(next);
                if (!nextSub) break;
                titleParts.push(nextSub);
                j += 1;
            }
            i = j - 1;
            curSub = { num: subCounter, title: titleParts.join(' ') };
            continue;
        }

        if (l.text) buf.push(l.text);
    }
    flush();

    console.log(`Extracted ${sections.length} sections.`);
    const chapters = new Set(sections.map((s) => s.chapter));
    console.log(
        `Chapters covered: ${chapters.size} (${[...chapters].sort((a, b) => a - b).join(', ')})`,
    );

    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(sections, null, 2), 'utf8');
    console.log('Wrote', OUT_PATH);
}

main().catch((err) => {
    console.error('splitOer failed:', err);
    process.exit(1);
});
