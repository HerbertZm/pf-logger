import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { syncCardeRounds, syncPfData } from '../ingestion/worker';
import { prisma } from '../db/prisma';

const router = Router();

// POST /api/sync  — manual trigger; worker normally handles this automatically
// Body: { tournamentId: number, sources?: ('carde' | 'purplefox')[] }
// Omitting sources syncs all enabled sources for the tournament.
router.post('/sync', asyncHandler(async (req: Request, res: Response) => {
  const { tournamentId, sources } = req.body as {
    tournamentId?: number;
    sources?: string[];
  };
  if (!tournamentId) {
    res.status(400).json({ error: 'tournamentId required' });
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

  const enabledSources = tournament.sourceMappings
    .filter((m) => m.isEnabled)
    .map((m) => m.source);

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

  res.json({
    ok: errors.length === 0,
    synced: toSync,
    errors: errors.length > 0 ? errors : undefined,
  });
}));

// POST /api/backfill  — re-process raw records into normalized tables
router.post('/backfill', asyncHandler(async (req: Request, res: Response) => {
  const { tournamentId } = req.body as { tournamentId?: number };
  if (!tournamentId) {
    res.status(400).json({ error: 'tournamentId required' });
    return;
  }
  // TODO: P0.5 — re-derive normalized tables from raw layer
  res.status(501).json({ error: 'Not implemented' });
}));

export { router as syncRouter };
