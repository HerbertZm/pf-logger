import { normalizeIsoUtc, UTC_DISPLAY_ZONE } from './datetime';

export const DEFAULT_TIMEZONE = 'America/New_York';

function parseUtcInstant(isoUtc: string | null | undefined): Date | null {
    if (!isoUtc) return null;
    const d = new Date(normalizeIsoUtc(isoUtc));
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format a UTC ISO timestamp in a display timezone (tournament local or UTC).
 * Storage and API are always UTC; only call this at render time.
 */
export const formatInTournamentTz = (
    isoUtc: string | null | undefined,
    timeZone: string,
    options?: Intl.DateTimeFormatOptions,
): string => {
    const d = parseUtcInstant(isoUtc);
    if (d === null) return '—';
    return d.toLocaleString(undefined, {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        ...options,
    });
};

/** Admin / global timestamps — stored UTC, shown as UTC. */
export const formatUtc = (
    isoUtc: string | null | undefined,
    options?: Intl.DateTimeFormatOptions,
): string => formatInTournamentTz(isoUtc, UTC_DISPLAY_ZONE, options);

export const formatUtcDateTime = (isoUtc: string | null | undefined): string =>
    formatInTournamentTz(isoUtc, UTC_DISPLAY_ZONE, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

/** @deprecated Use formatInTournamentTz (tournament UI) or formatUtc (admin). */
export const formatClock = formatUtc;

/** Short timezone label for context bar — e.g. "EDT" or "GMT-4". */
export const formatTzAbbrev = (timeZone: string, at: Date = new Date()): string => {
    try {
        const parts = new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: 'short' }).formatToParts(at);
        const tzPart = parts.find((p) => p.type === 'timeZoneName');
        return tzPart?.value ?? timeZone;
    } catch {
        return timeZone;
    }
};

export const formatTime = (seconds: number): string => {
    const abs = Math.abs(seconds);
    const mm = String(Math.floor(abs / 60)).padStart(2, '0');
    const ss = String(abs % 60).padStart(2, '0');
    return `${seconds < 0 ? '-' : ''}${mm}:${ss}`;
};

export const formatRelative = (date: Date): string => {
    const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    return `${Math.floor(diffMin / 60)}h ago`;
};
