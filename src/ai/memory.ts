import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const MEMORY_FILE = join(DATA_DIR, 'memories.json');

export interface Memory {
    id: string;
    userId: string | null; // null = globaal (voor alle gebruikers)
    key: string;
    value: string;
    updatedAt: string;
}

interface MemoryStore {
    memories: Memory[];
}

function load(): MemoryStore {
    if (!existsSync(MEMORY_FILE)) return { memories: [] };
    return JSON.parse(readFileSync(MEMORY_FILE, 'utf-8')) as MemoryStore;
}

function save(store: MemoryStore): void {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

/** Read all memories for a user (own + global). */
export function readMemories(userId: string): Memory[] {
    return load().memories.filter((m) => m.userId === userId || m.userId === null);
}

/** Write or update a memory for a user (or globally if userId is null). */
export function writeMemory(userId: string | null, key: string, value: string): void {
    const store = load();
    const idx = store.memories.findIndex((m) => m.userId === userId && m.key === key);
    const entry: Memory = { id: randomUUID(), userId, key, value, updatedAt: new Date().toISOString() };
    if (idx >= 0) {
        store.memories[idx] = entry;
    } else {
        store.memories.push(entry);
    }
    save(store);
}

/** Delete a memory for a user. Returns true if something was deleted. */
export function deleteMemory(userId: string | null, key: string): boolean {
    const store = load();
    const before = store.memories.length;
    store.memories = store.memories.filter((m) => !(m.userId === userId && m.key === key));
    if (store.memories.length !== before) { save(store); return true; }
    return false;
}

/** Format memories as a short context string to inject into the prompt. */
export function formatMemoriesForContext(userId: string): string {
    const memories = readMemories(userId);
    if (memories.length === 0) return '';
    const personal = memories.filter((m) => m.userId !== null);
    const global = memories.filter((m) => m.userId === null);
    const parts: string[] = [];
    if (personal.length) {
        parts.push('Persoonlijk:\n' + personal.map((m) => `- ${m.key}: ${m.value}`).join('\n'));
    }
    if (global.length) {
        parts.push('Globaal (geldt voor iedereen):\n' + global.map((m) => `- ${m.key}: ${m.value}`).join('\n'));
    }
    return parts.join('\n\n');
}
