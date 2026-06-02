export const DEFAULT_TIMEZONE = 'America/New_York';

/** Returns false for invalid or unsupported IANA timezone strings. */
export function isValidIanaTimezone(tz: string): boolean {
    if (!tz || tz.length > 64) return false;
    try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

export function assertValidTimezone(tz: string): string {
    if (!isValidIanaTimezone(tz)) {
        throw new Error(`Invalid timezone: ${tz}`);
    }
    return tz;
}
