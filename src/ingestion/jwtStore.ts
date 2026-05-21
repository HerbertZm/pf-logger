/**
 * In-memory PurpleFox JWT store — never persisted to DB.
 * Lost on server restart; staff must re-paste via the Session panel.
 * Only expiresAt is stored in the DB for UI status display.
 */

interface JwtEntry {
  jwt: string;
  expiresAt: string | null;
}

const store = new Map<number, JwtEntry>();

export function setPfJwt(tournamentId: number, jwt: string, expiresAt: string | null): void {
  store.set(tournamentId, { jwt, expiresAt });
}

export function getPfJwt(tournamentId: number): string | null {
  return store.get(tournamentId)?.jwt ?? null;
}

export function getPfJwtEntry(tournamentId: number): JwtEntry | null {
  return store.get(tournamentId) ?? null;
}

export function clearPfJwt(tournamentId: number): void {
  store.delete(tournamentId);
}
