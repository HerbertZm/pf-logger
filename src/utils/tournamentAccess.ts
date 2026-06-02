import type { Response } from 'express';
import { prisma } from '../db/prisma';

/** In production, test tournaments are hidden — return 404 for any tournament-scoped API. */
export async function rejectTestTournamentInProduction(
    tournamentId: number,
    res: Response,
): Promise<boolean> {
    if (process.env['NODE_ENV'] !== 'production') {
        return false;
    }
    const row = await prisma.appTournament.findUnique({
        where: { id: tournamentId },
        select: { isTestTournament: true },
    });
    if (row === null || row.isTestTournament) {
        res.status(404).json({ error: 'Tournament not found' });
        return true;
    }
    return false;
}
