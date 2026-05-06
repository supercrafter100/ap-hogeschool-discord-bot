// pdf-parse's index.js reads a test file on import — import the lib directly to avoid that
// @ts-expect-error — no types for the internal path, but the function signature is identical
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = join(__dirname, '../../OER_25-26_Dep-29.08.2025.pdf');

export async function loadOerText(): Promise<string> {
    const buffer = readFileSync(PDF_PATH);
    const data = await pdfParse(buffer);
    // Escape curly braces so LangChain template parsing doesn't choke on them
    return data.text.replace(/\{/g, '{{').replace(/\}/g, '}}');
}
