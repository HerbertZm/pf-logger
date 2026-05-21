/**
 * In-memory PurpleFox JWT store — never persisted to DB.
 * The PF JWT is a global staff credential, not per-tournament.
 * Lost on server restart; staff must re-paste via the Session panel.
 * Only expiresAt/setBy/setAt are stored in the DB (pf_session table) for UI status display.
 */

interface JwtEntry {
  jwt: string;
  expiresAt: string | null;
  setBy: string;
  setAt: string;
}

let entry: JwtEntry | null = null;

export function setPfJwt(jwt: string, expiresAt: string | null, setBy: string): void {
  entry = { jwt, expiresAt, setBy, setAt: new Date().toISOString() };
}

export function getPfJwt(): string | null {
  return entry?.jwt ?? null;
}

export function getPfJwtEntry(): JwtEntry | null {
  return entry;
}

export function clearPfJwt(): void {
  entry = null;
}

export function isPfJwtInMemory(): boolean {
  return entry !== null;
}
