import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAdmin } from '../middleware/auth';
import {
    buildRoundTimingReport,
    csvFilename,
    roundTimingReportToCsv,
} from '../services/roundTimingReport';
import { rejectTestTournamentInProduction } from '../utils/tournamentAccess';

const router = Router();

router.use(requireAdmin);

function parseTournamentId(query: Request['query']): number | null {
    const tid = Number(query['tournamentId']);
    if (Number.isNaN(tid) || tid === 0) return null;
    return tid;
}

// GET /api/reports/round-timing?tournamentId=:id
router.get(
    '/round-timing',
    asyncHandler(async (req: Request, res: Response) => {
        const tid = parseTournamentId(req.query);
        if (tid === null) {
            res.status(400).json({ error: 'tournamentId required' });
            return;
        }
        if (await rejectTestTournamentInProduction(tid, res)) {
            return;
        }

        const report = await buildRoundTimingReport(tid);
        if (report === null) {
            res.status(404).json({ error: 'Tournament not found' });
            return;
        }

        res.json(report.rows);
    }),
);

// GET /api/reports/round-timing/export?tournamentId=:id[&timezone=America/New_York]
router.get(
    '/round-timing/export',
    asyncHandler(async (req: Request, res: Response) => {
        const tid = parseTournamentId(req.query);
        if (tid === null) {
            res.status(400).json({ error: 'tournamentId required' });
            return;
        }
        if (await rejectTestTournamentInProduction(tid, res)) {
            return;
        }

        const report = await buildRoundTimingReport(tid);
        if (report === null) {
            res.status(404).json({ error: 'Tournament not found' });
            return;
        }

        const timeZone =
            typeof req.query['timezone'] === 'string' && req.query['timezone'].length > 0
                ? req.query['timezone']
                : 'America/New_York';

        const csv = roundTimingReportToCsv(report.rows, timeZone);
        const filename = csvFilename(report.shortName);

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    }),
);

export { router as reportsRouter };
