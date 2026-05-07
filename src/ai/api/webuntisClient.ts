export interface WuClass {
    id: number;
    name: string;
    longName: string;
}

export interface WuElement {
    type: number;
    id: number;
    name?: string | null;
    longName?: string | null;
}

export interface WuPeriod {
    id: number;
    date: number;      // YYYYMMDD
    startTime: number; // HHMM (e.g. 1600 = 16:00)
    endTime: number;
    lessonText: string;
    elements: Array<{ type: number; id: number }>;
    cellState: string; // 'STANDARD' | 'CANCELLED' | ...
    code: number;      // 0 = normal
}

export interface WuWeeklyData {
    elementPeriods: Record<string, WuPeriod[]>;
    elements: WuElement[];
}

const BASE = 'https://ap.webuntis.com/WebUntis';

let classListCache: { data: WuClass[]; expiresAt: number } | null = null;
const timetableCache = new Map<string, { data: WuWeeklyData; expiresAt: number }>();

const CLASS_TTL = 24 * 60 * 60 * 1000;  // 24h
const TIMETABLE_TTL = 15 * 60 * 1000;   // 15min (substitutions can happen)

export async function getClasses(): Promise<WuClass[]> {
    if (classListCache && classListCache.expiresAt > Date.now()) return classListCache.data;

    const res = await fetch(`${BASE}/api/public/timetable/weekly/pageconfig?type=1`);
    if (!res.ok) throw new Error(`WebUntis classes ${res.status}`);
    const json = (await res.json()) as { data: { elements: WuClass[] } };
    classListCache = { data: json.data.elements, expiresAt: Date.now() + CLASS_TTL };
    return json.data.elements;
}

// Normalise Discord track names to WebUntis class name segment
function trackCode(track: string, year: number): string {
    const t = track.toUpperCase().replace(/\s+/g, '');
    if (t === 'MR' || t === 'IMMERSIVETECHNOLOGIES' || t === 'IMT') {
        return year === 1 ? 'IMT' : 'MR';
    }
    return t; // AI, SOF, CSC, IOT
}

/**
 * Find all WebUntis class IDs for a given year + track combination.
 * Handles both regular classes (1ITAI1) and verkort-traject classes (1ITVTAI_TI1).
 * If track starts with "VT" (e.g. "VTAI"), only VT classes are returned.
 * Optionally filter by group number (1-based suffix).
 */
export async function findClassIds(year: number, track: string, group?: number): Promise<WuClass[]> {
    const classes = await getClasses();

    // Strip leading "VT" if present so we can build both prefixes cleanly
    const vtOnly = /^VT/i.test(track);
    const baseTrack = track.replace(/^VT/i, '');
    const tc = trackCode(baseTrack, year);

    const regularPrefix = `${year}IT${tc}`;
    const vtPrefix = `${year}ITVT${tc}`;

    const matches = classes.filter((c) => {
        // Regular classes: 1ITAI1, 1ITSOF2, … (pure numeric suffix)
        if (!vtOnly && c.name.startsWith(regularPrefix)) {
            const suffix = c.name.slice(regularPrefix.length);
            return /^\d+$/.test(suffix);
        }
        // VT (verkort traject) classes: 1ITVTAI_TI1, 1ITVTAI_EA1, 1ITVTCSC1, …
        // Suffix can be: _TI1, _EA1, 1, etc. — exclude _U (uitdovend)
        if (c.name.startsWith(vtPrefix)) {
            const suffix = c.name.slice(vtPrefix.length);
            return /^(_[A-Z]+)?\d+$/.test(suffix);
        }
        return false;
    });

    if (group !== undefined) {
        return matches.filter((c) => c.name.endsWith(String(group)));
    }
    return matches;
}

export async function getWeeklyTimetable(classId: number, date: string): Promise<WuWeeklyData> {
    const key = `${classId}:${date}`;
    const cached = timetableCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const res = await fetch(
        `${BASE}/api/public/timetable/weekly/data?elementType=1&elementId=${classId}&date=${date}&formatId=1`,
    );
    if (!res.ok) throw new Error(`WebUntis timetable ${res.status}`);
    const json = (await res.json()) as { data: { result: { data: WuWeeklyData } } };
    const data = json.data.result.data;
    timetableCache.set(key, { data, expiresAt: Date.now() + TIMETABLE_TTL });
    return data;
}

// ---- Formatting helpers ----

const NL_DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

function formatTime(t: number): string {
    const h = Math.floor(t / 100);
    const m = t % 100;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatDate(d: number): string {
    const s = String(d);
    const year = parseInt(s.slice(0, 4));
    const month = parseInt(s.slice(4, 6));
    const day = parseInt(s.slice(6, 8));
    const dow = new Date(year, month - 1, day).getDay();
    return `${NL_DAYS[dow] ?? '?'} ${day}/${month}`;
}

interface FormattedLesson {
    time: string;
    subject: string;
    room: string;
    type: string;
    cancelled: boolean;
}

interface FormattedDay {
    label: string;
    lessons: FormattedLesson[];
}

export function formatTimetable(className: string, classId: number, data: WuWeeklyData): string {
    const periods = data.elementPeriods[String(classId)] ?? [];

    // Build element lookup
    const lookup = new Map<string, string>();
    for (const el of data.elements) {
        const display = (el.longName ?? '').trim() || (el.name ?? '').trim();
        lookup.set(`${el.type}:${el.id}`, display);
    }

    // Group by date
    const byDate = new Map<number, FormattedLesson[]>();
    for (const p of periods) {
        const lessons = byDate.get(p.date) ?? [];
        const cancelled = p.cellState === 'CANCELLED' || p.code !== 0;
        const subject = p.elements
            .filter((e) => e.type === 3)
            .map((e) => lookup.get(`3:${e.id}`) ?? '?')
            .join(', ') || p.lessonText || '?';
        const room = p.elements
            .filter((e) => e.type === 4)
            .map((e) => {
                const full = lookup.get(`4:${e.id}`) ?? '';
                // Shorten "03.06.ELL (48) Leslokaal" → "ELL.03.06"
                const m = full.match(/^(\d+\.\d+)\.(\w+)/);
                return m ? `${m[2]}.${m[1]}` : full || '?';
            })
            .join(', ');
        lessons.push({
            time: `${formatTime(p.startTime)}–${formatTime(p.endTime)}`,
            subject,
            room,
            type: p.lessonText,
            cancelled,
        });
        byDate.set(p.date, lessons);
    }

    if (byDate.size === 0) return `Geen lessen gevonden voor **${className}** deze week.`;

    const days: FormattedDay[] = [];
    for (const [date, lessons] of [...byDate.entries()].sort((a, b) => a[0] - b[0])) {
        // Merge consecutive identical subjects
        const merged: FormattedLesson[] = [];
        for (const l of lessons.sort((a, b) => a.time.localeCompare(b.time))) {
            const prev = merged[merged.length - 1];
            if (prev && prev.subject === l.subject && prev.room === l.room && prev.time.split('–')[1] === l.time.split('–')[0]) {
                prev.time = `${prev.time.split('–')[0]}–${l.time.split('–')[1]}`;
            } else {
                merged.push({ ...l });
            }
        }
        days.push({ label: formatDate(date), lessons: merged });
    }

    const lines = [`📅 **Rooster ${className}**\n`];
    for (const day of days) {
        lines.push(`**${day.label}**`);
        for (const l of day.lessons) {
            const strike = l.cancelled ? '~~' : '';
            const roomStr = l.room ? ` _(${l.room})_` : '';
            lines.push(`  ${l.time}  ${strike}${l.subject}${roomStr}${strike}`);
        }
    }

    return lines.join('\n');
}
