import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// POST /api/sync  — manual trigger; worker normally handles this automatically
router.post('/sync', asyncHandler(async (req: Request, res: Response) => {
  const { tournamentId } = req.body as { tournamentId?: number };
  if (!tournamentId) {
    res.status(400).json({ error: 'tournamentId required' });
    return;
  }
  // TODO: P0.4/P0.5 — trigger worker sync cycle for this tournament
  res.status(501).json({ error: 'Not implemented' });
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
