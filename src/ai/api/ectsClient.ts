import type {
    Academiejaar,
    Opleiding,
    ZoekResultaat,
    ProgrammaDetail,
    Traject,
    OlodFiche,
} from '../types/ects.js';

const BASE_URL = 'https://apih.ap.be/nl/studyguide/ects/public';
const PUBLIC_BASE_URL = 'https://ects.ap.be/ects';

// In-memory cache: ECTS-data verandert nauwelijks (1x per academiejaar)
const apiCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 uur

async function apiFetch<T>(path: string): Promise<T> {
    const now = Date.now();
    const cached = apiCache.get(path);
    if (cached && cached.expiresAt > now) {
        return cached.data as T;
    }
    const res = await fetch(`${BASE_URL}${path}`);
    if (!res.ok) throw new Error(`ECTS API ${res.status} voor ${path}`);
    const data = (await res.json()) as T;
    apiCache.set(path, { data, expiresAt: now + CACHE_TTL_MS });
    return data;
}

export function getPubliekeOpleidingUrl(jaar: string, programmaUrl: string): string {
    return `${PUBLIC_BASE_URL}/opleiding/${jaar}/${programmaUrl}`;
}

export function getPubliekeTrajectUrl(jaar: string, programmaUrl: string, trajectId: string): string {
    return `${PUBLIC_BASE_URL}/opleiding/${jaar}/${programmaUrl}/${trajectId}`;
}

// Geen jaar nodig — de publieke ECTS-site gebruikt enkel het id
export function getPubliekeOlodUrl(id: number | string): string {
    return `${PUBLIC_BASE_URL}/opleidings-onderdeel/${id}`;
}

export async function getAcademiejaren(): Promise<Academiejaar[]> {
    return apiFetch('/academiejaren');
}


export async function getOpleidingen(jaar: string): Promise<Opleiding[]> {
    return apiFetch(`/${encodeURIComponent(jaar)}`);
}

export async function zoek(jaar: string, query: string): Promise<ZoekResultaat> {
    return apiFetch(`/search/${encodeURIComponent(jaar)}/${encodeURIComponent(query)}`);
}

export async function getProgramma(jaar: string, programmaUrl: string): Promise<ProgrammaDetail> {
    return apiFetch(`/${encodeURIComponent(jaar)}/${encodeURIComponent(programmaUrl)}`);
}

export async function getTraject(
    jaar: string,
    programmaUrl: string,
    trajectId: string,
): Promise<Traject> {
    return apiFetch(
        `/${encodeURIComponent(jaar)}/${encodeURIComponent(programmaUrl)}/${encodeURIComponent(trajectId)}`,
    );
}

export async function getOpleidingsonderdeel(id: number | string): Promise<OlodFiche> {
    return apiFetch(`/opleidingsonderdeel/${encodeURIComponent(String(id))}`);
}
