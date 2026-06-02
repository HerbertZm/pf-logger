import { prisma } from '../db/prisma';
import { getPfJwtEntry, isPfJwtInMemory } from '../ingestion/jwtStore';

export interface TournamentWorkerHealth {
    tournamentId: number;
    name: string;
    isRunning: boolean;
    lastError: string | null;
    lastRoundsFetchedAt: string | null;
    lastMatchesFetchedAt: string | null;
    lastPfFetchedAt: string | null;
}

export interface HealthStatus {
    ok: boolean;
    uptime: number;
    db: 'ok' | 'error';
    pfJwt: {
        inMemory: boolean;
        expiresAt: string | null;
        setBy: string | null;
        expired: boolean;
    };
    tournaments: TournamentWorkerHealth[];
}

export interface PublicHealthStatus {
    ok: boolean;
    uptime: number;
    db: 'ok' | 'error';
}

/** Unauthenticated liveness — no tournament names, JWT metadata, or worker errors. */
export async function buildPublicHealthStatus(uptimeSec: number): Promise<PublicHealthStatus> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return { ok: true, uptime: uptimeSec, db: 'ok' };
    } catch {
        return { ok: false, uptime: uptimeSec, db: 'error' };
    }
}

export async function buildHealthStatus(uptimeSec: number): Promise<HealthStatus> {
    try {
        await prisma.$queryRaw`SELECT 1`;
    } catch {
        return {
            ok: false,
            uptime: uptimeSec,
            db: 'error',
            pfJwt: { inMemory: false, expiresAt: null, setBy: null, expired: false },
            tournaments: [],
        };
    }

    const jwtEntry = getPfJwtEntry();
    const expiresAt = jwtEntry?.expiresAt ?? null;
    const expired = expiresAt !== null && new Date(expiresAt) < new Date();

    const isProduction = process.env['NODE_ENV'] === 'production';
    const workerRows = await prisma.workerState.findMany({
        where: {
            tournament: {
                isActive: true,
                deletedAt: null,
                ...(isProduction ? { isTestTournament: false } : {}),
            },
        },
        include: { tournament: { select: { id: true, name: true } } },
    });

    const tournaments: TournamentWorkerHealth[] = workerRows.map((w) => ({
        tournamentId: w.tournamentId,
        name: w.tournament.name,
        isRunning: w.isRunning,
        lastError: w.lastError,
        lastRoundsFetchedAt: w.lastRoundsFetchedAt?.toISOString() ?? null,
        lastMatchesFetchedAt: w.lastMatchesFetchedAt?.toISOString() ?? null,
        lastPfFetchedAt: w.lastPfFetchedAt?.toISOString() ?? null,
    }));

    return {
        ok: true,
        uptime: uptimeSec,
        db: 'ok',
        pfJwt: {
            inMemory: isPfJwtInMemory(),
            expiresAt,
            setBy: jwtEntry?.setBy ?? null,
            expired,
        },
        tournaments,
    };
}
