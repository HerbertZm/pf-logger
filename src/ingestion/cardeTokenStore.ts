/**
 * In-memory Carde.io token store.
 * Falls back to CARDE_API_TOKEN env var when no override is set.
 * Lost on server restart; re-paste via the Manage → Service credentials panel.
 */

interface TokenEntry {
    token: string;
    setBy: string;
    setAt: string;
}

let entry: TokenEntry | null = null;

export function setCardeToken(token: string, setBy: string): void {
    entry = { token, setBy, setAt: new Date().toISOString() };
}

/** Returns in-memory override, or the CARDE_API_TOKEN env var, or empty string. */
export function getCardeToken(): string {
    return entry?.token ?? process.env['CARDE_API_TOKEN'] ?? '';
}

export function clearCardeToken(): void {
    entry = null;
}

export function isCardeTokenInMemory(): boolean {
    return entry !== null;
}

export function getCardeTokenEntry(): TokenEntry | null {
    return entry;
}
