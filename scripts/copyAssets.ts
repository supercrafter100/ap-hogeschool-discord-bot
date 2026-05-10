// Copy non-TS runtime assets from src/ to dist/ after tsc.
// tsc only emits .js/.d.ts, so .txt and .json data files are missed otherwise.

import { cpSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const ASSETS: { from: string; to: string }[] = [
    { from: 'src/ai/data', to: 'dist/ai/data' },
];

for (const a of ASSETS) {
    const from = join(ROOT, a.from);
    const to = join(ROOT, a.to);
    if (!existsSync(from)) {
        console.warn(`[copyAssets] skip — source missing: ${from}`);
        continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
    console.log(`[copyAssets] ${a.from} -> ${a.to}`);
}
