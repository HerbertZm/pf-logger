/** IANA zone for stored UTC instants shown as absolute time (Manage, sessions, audit). */
export const UTC_DISPLAY_ZONE = 'UTC';

const HAS_EXPLICIT_TZ = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** API returns UTC ISO; normalize naive strings defensively. */
export function normalizeIsoUtc(iso: string): string {
    const s = iso.trim();
    if (HAS_EXPLICIT_TZ.test(s)) return s;
    if (s.includes('T')) return `${s}Z`;
    return s;
}
