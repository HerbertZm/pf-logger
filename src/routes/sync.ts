import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { AuthenticatedRequest, requireAdmin } from '../middleware/auth';
import { syncRateLimit } from '../middleware/rateLimit';
import { backfillTournamentFromRaw } from '../ingestion/backfillFromRaw';
import { syncCardeRounds, syncPfData } from '../ingestion/worker';
import { prisma } from '../db/prisma';
import { auditFromRequest } from '../services/auditLog';
import { rejectTestTournamentInProduction } from '../utils/tournamentAccess';

const router = Router();
router.use(requireAdmin);
router.use(syncRateLimit);

// POST /api/sync  — manual trigger; worker normally handles this automatically
// Body: { tournamentId: number, sources?: ('carde' | 'purplefox')[] }
// Omitting sources syncs all enabled sources for the tournament.
router.post(
    '/sync',
    asyncHandler(async (req: Request, res: Response) => {
        const { tournamentId, sources } = req.body as {
            tournamentId?: number;
            sources?: string[];
        };
        if (!tournamentId) {
            res.status(400).json({ error: 'tournamentId required' });
            return;
        }
        if (await rejectTestTournamentInProduction(tournamentId, res, (req as AuthenticatedRequest).user)) {
            return;
        }

        // Verify tournament exists and is active
        const tournament = await prisma.appTournament.findUnique({
            where: { id: tournamentId },
            include: { sourceMappings: true },
        });
        if (!tournament) {
            res.status(404).json({ error: 'Tournament not found' });
            return;
        }
        if (!tournament.isActive || tournament.isEnded || tournament.deletedAt) {
            res.status(409).json({ error: 'Tournament is not active' });
            return;
        }

        const enabledSources = tournament.sourceMappings.filter((m) => m.isEnabled).map((m) => m.source);

        const requested = sources ?? enabledSources;
        const toSync = requested.filter((s) => enabledSources.includes(s));

        if (toSync.length === 0) {
            res.status(400).json({ error: 'No enabled sources match the requested sync' });
            return;
        }

        // Fire sync tasks; collect any immediate errors (timeouts will resolve async)
        const errors: string[] = [];
        await Promise.allSettled([
            toSync.includes('carde')
                ? syncCardeRounds(tournamentId).catch((err) => {
                      errors.push(`carde: ${String(err)}`);
                  })
                : Promise.resolve(),
            toSync.includes('purplefox')
                ? syncPfData(tournamentId).catch((err) => {
                      errors.push(`purplefox: ${String(err)}`);
                  })
                : Promise.resolve(),
        ]);

        void auditFromRequest(
            req,
            'manual_sync',
            `tournamentId=${tournamentId} sources=${toSync.join(',')}${errors.length > 0 ? ` errors=${errors.join(';')}` : ''}`,
        );

        res.json({
            ok: errors.length === 0,
            synced: toSync,
            errors: errors.length > 0 ? errors : undefined,
        });
    }),
);

// POST /api/backfill  — re-process raw records into normalized tables (no API calls)
router.post(
    '/backfill',
    asyncHandler(async (req: Request, res: Response) => {
        const { tournamentId } = req.body as { tournamentId?: number };
        if (tournamentId === undefined || tournamentId === null) {
            res.status(400).json({ error: 'tournamentId required' });
            return;
        }

        const tournament = await prisma.appTournament.findUnique({ where: { id: tournamentId } });
        if (!tournament) {
            res.status(404).json({ error: 'Tournament not found' });
            return;
        }
        if (await rejectTestTournamentInProduction(tournamentId, res, (req as AuthenticatedRequest).user)) {
            return;
        }

        const result = await backfillTournamentFromRaw(tournamentId);
        void auditFromRequest(req, 'tournament_backfill', `tournamentId=${tournamentId} ${JSON.stringify(result)}`);

        res.json({ ok: true, tournamentId, ...result });
    }),
);

export { router as syncRouter };
