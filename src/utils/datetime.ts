import { DEFAULT_TIMEZONE } from './timezone';

/** ISO string includes Z or a numeric UTC offset. */
const HAS_EXPLICIT_TZ = /(?:Z|[+-]\d{2}:?\d{2})$/i;

const NAIVE_ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/**
 * Parse an external timestamp to a UTC instant for TIMESTAMPTZ storage.
 * - Strings with Z or ±offset: parsed as given.
 * - Naive ISO strings: wall time in `defaultTimeZone` (Carde US events), else UTC if omitted.
 */
export function parseUtcTimestamp(
    value: string | Date | null | undefined,
    options?: { defaultTimeZone?: string },
): Date | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    const s = value.trim();
    if (!s) return null;

    if (HAS_EXPLICIT_TZ.test(s)) {
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const tz = options?.defaultTimeZone;
    if (tz) {
        const wall = wallTimeInZoneToUtc(s, tz);
        if (wall !== null) return wall;
    }

    const d = new Date(s.includes('T') ? `${s}Z` : s);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** PF Supabase timestamps without suffix are UTC wall times. */
export function parsePfTimestamp(value: string): Date {
    const s = value.trim();
    const parsed = parseUtcTimestamp(HAS_EXPLICIT_TZ.test(s) ? s : `${s}Z`);
    if (parsed === null) {
        throw new Error(`Invalid PF timestamp: ${value}`);
    }
    return parsed;
}

/** Serialize DB Date to ISO-8601 UTC for JSON (always ends with Z). */
export function toIsoUtc(value: Date | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return value.toISOString();
}

/** Wall-clock display for exports (CSV); storage remains UTC. */
export function formatWallClock(
    isoUtc: string | null,
    timeZone: string,
    options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' },
): string {
    if (isoUtc === null) return '';
    const d = new Date(isoUtc);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { ...options, timeZone });
}

export function parseCardeTimestamp(
    value: string | null | undefined,
    tournamentTimeZone: string = DEFAULT_TIMEZONE,
): Date | null {
    return parseUtcTimestamp(value, { defaultTimeZone: tournamentTimeZone });
}

function wallTimeInZoneToUtc(isoLocal: string, timeZone: string): Date | null {
    const m = isoLocal.match(NAIVE_ISO);
    if (!m) return null;

    const parts = {
        y: Number(m[1]),
        mo: Number(m[2]) - 1,
        d: Number(m[3]),
        h: Number(m[4]),
        mi: Number(m[5]),
        s: Number(m[6] ?? 0),
    };

    let utcMs = Date.UTC(parts.y, parts.mo, parts.d, parts.h, parts.mi, parts.s);
    for (let i = 0; i < 5; i++) {
        const dtf = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        });
        const fp = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
        const shownMs = Date.UTC(
            Number(fp['year']),
            Number(fp['month']) - 1,
            Number(fp['day']),
            Number(fp['hour']),
            Number(fp['minute']),
            Number(fp['second']),
        );
        const targetMs = Date.UTC(parts.y, parts.mo, parts.d, parts.h, parts.mi, parts.s);
        utcMs += targetMs - shownMs;
    }

    const d = new Date(utcMs);
    return Number.isNaN(d.getTime()) ? null : d;
}
