import type { Response } from 'express';
import { prisma } from '../db/prisma';

const TEST_TOURNAMENT_USERNAMES = new Set(['demouser']);

export function canAccessTestTournaments(user: { role: string; username: string }): boolean {
    return user.role === 'admin' || user.role === 'superadmin' || TEST_TOURNAMENT_USERNAMES.has(user.username);
}

/** In production, test tournaments are hidden — unless the user is admin/superadmin or demouser. */
export async function rejectTestTournamentInProduction(
    tournamentId: number,
    res: Response,
    user: { role: string; username: string },
): Promise<boolean> {
    if (process.env['NODE_ENV'] !== 'production') {
        return false;
    }
    if (canAccessTestTournaments(user)) {
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
