export const DEFAULT_TIMEZONE = 'America/New_York';

/** Format an ISO timestamp as a locale clock time in the browser timezone (legacy). */
export const formatClock = (iso: string | null | undefined): string => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/** Format an ISO UTC timestamp in a specific IANA timezone. */
export const formatInTournamentTz = (
    isoUtc: string | null | undefined,
    timeZone: string,
    options?: Intl.DateTimeFormatOptions,
): string => {
    if (!isoUtc) return '—';
    const d = new Date(isoUtc);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        ...options,
    });
};

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
