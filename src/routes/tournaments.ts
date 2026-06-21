import { Router, Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { AuthenticatedRequest, requireAdmin } from '../middleware/auth';
import type { Tournament, ActiveRoundResponse, LogsResponse, RoundSummary, WorkerStatus, Game, FixedSeatEntry, FixedSeatingResponse } from '../api/types';
import { fetchCardeFixedSeatRegistrations, fetchCardeAllRoundMatches } from '../ingestion/providers/carde';
import {
    serializeRound,
    serializeDrop,
    serializeExtension,
    serializePenalty,
    serializeCoverage,
    serializeJudgeCall,
    serializeGame,
    serializeTournament,
} from './serializers';
import { stopTournamentWorker } from '../ingestion/worker';
import { auditFromRequest } from '../services/auditLog';
import { canAccessTestTournaments, rejectTestTournamentInProduction } from '../utils/tournamentAccess';

const router = Router();

// POST /api/end-tournament — admin+; freezes is_ended (never reset by sync)
router.post(
    '/end-tournament',
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
        const body = req.body as { tournamentId?: number };
        const tid = Number(body.tournamentId ?? req.query['tournamentId']);
        if (!tid) {
            res.status(400).json({ error: 'tournamentId required' });
            return;
        }
        if (await rejectTestTournamentInProduction(tid, res, (req as AuthenticatedRequest).user)) {
            return;
        }
        try {
            await prisma.appTournament.update({
                where: { id: tid },
                data: { isEnded: true, isActive: false },
            });
        } catch (err: unknown) {
            if ((err as { code?: string }).code === 'P2025') {
                res.status(404).json({ error: 'Tournament not found' });
                return;
            }
            throw err;
        }
        stopTournamentWorker(tid);
        void auditFromRequest(req, 'tournament_ended', `tournamentId=${tid}`);
        res.json({ ok: true });
    }),
);

// GET /api/games
router.get(
    '/games',
    asyncHandler(async (_req: Request, res: Response) => {
        const games = await prisma.game.findMany({ orderBy: { name: 'asc' } });
        const body: Game[] = games.map(serializeGame);
        res.json(body);
    }),
);

// GET /api/tournaments
router.get(
    '/tournaments',
    asyncHandler(async (req: Request, res: Response) => {
        const user = (req as AuthenticatedRequest).user;
        const hideTestTournaments =
            process.env['NODE_ENV'] === 'production' && !canAccessTestTournaments(user);
        const tournaments = await prisma.appTournament.findMany({
            where: {
                deletedAt: null,
                ...(hideTestTournaments ? { isTestTournament: false } : {}),
            },
            include: { sourceMappings: true, game: true, event: true },
            orderBy: { createdAt: 'desc' },
        });

        const body: Tournament[] = tournaments.map(serializeTournament);

        res.json(body);
    }),
);

// GET /api/rounds?tournamentId=:id — lightweight round list for selectors
router.get(
    '/rounds',
    asyncHandler(async (req: Request, res: Response) => {
        const tid = Number(req.query['tournamentId']);
        if (!tid) {
            res.status(400).json({ error: 'tournamentId required' });
            return;
        }
        if (await rejectTestTournamentInProduction(tid, res, (req as AuthenticatedRequest).user)) {
            return;
        }
        const rounds = await prisma.round.findMany({
            where: { tournamentId: tid },
            orderBy: { roundNumber: 'asc' },
        });
        res.json(rounds.map(serializeRound));
    }),
);

// GET /api/dashboard/active-round?tournamentId=:id[&roundNumber=:n]
// If roundNumber is provided, returns that specific round; otherwise returns latest active/complete.
router.get(
    '/dashboard/active-round',
    asyncHandler(async (req: Request, res: Response) => {
        const tid = Number(req.query['tournamentId']);
        if (!tid) {
            res.status(400).json({ error: 'tournamentId required' });
            return;
        }
        if (await rejectTestTournamentInProduction(tid, res, (req as AuthenticatedRequest).user)) {
            return;
        }

        const requestedRound = req.query['roundNumber'] ? Number(req.query['roundNumber']) : null;

        const round = requestedRound
            ? await prisma.round.findFirst({
                  where: { tournamentId: tid, roundNumber: requestedRound },
              })
            : await prisma.round.findFirst({
                  where: {
                      tournamentId: tid,
                      cardeStatus: { in: ['IN_PROGRESS', 'COMPLETE'] },
                  },
                  orderBy: { roundNumber: 'desc' },
              });

        if (!round) {
            res.json(null);
            return;
        }

        const inProgressMatches = await prisma.match.findMany({
            where: { tournamentId: tid, roundId: round.id, status: 'IN_PROGRESS' },
            select: { tableNumber: true },
        });

        const outstandingTables: number[] = inProgressMatches.map((m) => m.tableNumber);

        const [extensions, dropCount, penaltyCount] = await Promise.all([
            prisma.extension.findMany({
                where: { tournamentId: tid, round: round.roundNumber },
                orderBy: { createdAt: 'asc' },
            }),
            prisma.drop.count({
                where: { tournamentId: tid, round: round.roundNumber, isCancelled: false },
            }),
            prisma.penalty.count({
                where: { tournamentId: tid, round: round.roundNumber },
            }),
        ]);

        // Tables with extensions: from PF extension records (Carde timeExtensionSec is always 0)
        const tablesWithExtensions: number[] = [
            ...new Set(extensions.map((e) => e.tableNumber).filter((n): n is number => n !== null)),
        ];

        const body: ActiveRoundResponse = {
            round: serializeRound(round),
            outstandingTables,
            tablesWithExtensions,
            extensions: extensions.map(serializeExtension),
            dropCount,
            penaltyCount,
            nowUtc: new Date().toISOString(),
        };

        res.json(body);
    }),
);

// GET /api/logs?tournamentId=:id
router.get(
    '/logs',
    asyncHandler(async (req: Request, res: Response) => {
        const tid = Number(req.query['tournamentId']);
        if (!tid) {
            res.status(400).json({ error: 'tournamentId required' });
            return;
        }
        if (await rejectTestTournamentInProduction(tid, res, (req as AuthenticatedRequest).user)) {
            return;
        }

        const [rounds, drops, extensions, penalties, coverage, judgeCalls] = await Promise.all([
            prisma.round.findMany({ where: { tournamentId: tid }, orderBy: { roundNumber: 'asc' } }),
            prisma.drop.findMany({ where: { tournamentId: tid }, orderBy: { id: 'asc' } }),
            prisma.extension.findMany({ where: { tournamentId: tid }, orderBy: { createdAt: 'asc' } }),
            prisma.penalty.findMany({ where: { tournamentId: tid }, orderBy: { createdAt: 'asc' } }),
            prisma.tableCoverage.findMany({
                where: { tournamentId: tid },
                orderBy: { firstSeenAt: 'asc' },
            }),
            prisma.tableJudgeCall.findMany({
                where: { tournamentId: tid },
                orderBy: { firstSeenAt: 'asc' },
            }),
        ]);

        // Resolve PF staff UUIDs → display names for extension entries
        const extUserIds = [...new Set(extensions.map((e) => e.userId).filter((id): id is string => id !== null))];
        const staffRows =
            extUserIds.length > 0 ? await prisma.pfStaff.findMany({ where: { pfUserId: { in: extUserIds } } }) : [];
        const staffMap = new Map(staffRows.map((s) => [s.pfUserId, s.displayName]));

        const entries: LogsResponse['entries'] = [
            ...drops.map((d) => ({ type: 'drop' as const, ...serializeDrop(d) })),
            ...extensions.map((e) => ({
                type: 'extension' as const,
                ...serializeExtension(e),
                staffName: e.userId ? (staffMap.get(e.userId) ?? null) : null,
            })),
            ...penalties.map((p) => ({ type: 'penalty' as const, ...serializePenalty(p) })),
            ...coverage.map((c) => ({ type: 'coverage' as const, ...serializeCoverage(c) })),
            ...judgeCalls.map((j) => ({ type: 'judge_call' as const, ...serializeJudgeCall(j) })),
        ].sort((a, b) => entryTime(a) - entryTime(b));

        const body: LogsResponse = {
            rounds: rounds.map(serializeRound),
            entries,
        };

        res.json(body);
    }),
);

// GET /api/insights?tournamentId=:id
router.get(
    '/insights',
    asyncHandler(async (req: Request, res: Response) => {
        const tid = Number(req.query['tournamentId']);
        if (!tid) {
            res.status(400).json({ error: 'tournamentId required' });
            return;
        }
        if (await rejectTestTournamentInProduction(tid, res, (req as AuthenticatedRequest).user)) {
            return;
        }

        const rounds = await prisma.round.findMany({
            where: { tournamentId: tid },
            orderBy: { roundNumber: 'asc' },
        });

        const summaries: RoundSummary[] = await Promise.all(
            rounds.map(async (round) => {
                const [dropCount, extensionCount, penaltyCount, extensions] = await Promise.all([
                    prisma.drop.count({
                        where: { tournamentId: tid, round: round.roundNumber, isCancelled: false },
                    }),
                    prisma.extension.count({ where: { tournamentId: tid, round: round.roundNumber } }),
                    prisma.penalty.count({ where: { tournamentId: tid, round: round.roundNumber } }),
                    prisma.extension.findMany({ where: { tournamentId: tid, round: round.roundNumber } }),
                ]);

                const outstandingAtTimeCalled =
                    round.missingTablesJson !== null ? (round.missingTablesJson as number[]).length : 0;

                // lastMatchCompletedAt - timerEndDatetime = actual overtime (clamped to 0 for on-time rounds)
                const overtimeMinutes =
                    round.lastMatchCompletedAt !== null && round.timerEndDatetime !== null
                        ? Math.max(
                              0,
                              Math.round(
                                  (round.lastMatchCompletedAt.getTime() - round.timerEndDatetime.getTime()) / 60_000,
                              ),
                          )
                        : null;

                return {
                    round: serializeRound(round),
                    dropCount,
                    extensionCount,
                    penaltyCount,
                    outstandingAtTimeCalled,
                    overtimeMinutes,
                    extensions: extensions.map(serializeExtension),
                };
            }),
        );

        res.json(summaries);
    }),
);

const MAX_OPERATOR_NOTES_LEN = 2000;

// PATCH /api/rounds/:id/notes — admin+; operator notes are never synced externally
router.patch(
    '/rounds/:id/notes',
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
        const id = Number(req.params['id']);
        if (!id) {
            res.status(400).json({ error: 'invalid id' });
            return;
        }

        const roundRow = await prisma.round.findUnique({
            where: { id },
            select: { tournamentId: true },
        });
        if (roundRow === null) {
            res.status(404).json({ error: 'Round not found' });
            return;
        }
        if (await rejectTestTournamentInProduction(roundRow.tournamentId, res, (req as AuthenticatedRequest).user)) {
            return;
        }

        const body = req.body as { notes?: unknown };
        if (!('notes' in body)) {
            res.status(400).json({ error: 'notes is required (string or null)' });
            return;
        }
        const { notes } = body;
        if (notes !== null && typeof notes !== 'string') {
            res.status(400).json({ error: 'notes must be a string or null' });
            return;
        }
        if (typeof notes === 'string' && notes.length > MAX_OPERATOR_NOTES_LEN) {
            res.status(400).json({ error: `notes must be at most ${MAX_OPERATOR_NOTES_LEN} characters` });
            return;
        }

        let operatorNotes: string | null;
        if (notes === null || notes === undefined) {
            operatorNotes = null;
        } else {
            const trimmed = notes.trim();
            operatorNotes = trimmed === '' ? null : trimmed;
        }

        let round;
        try {
            round = await prisma.round.update({
                where: { id },
                data: { operatorNotes },
            });
        } catch (err: unknown) {
            if ((err as { code?: string }).code === 'P2025') {
                res.status(404).json({ error: 'Round not found' });
                return;
            }
            throw err;
        }

        res.json(serializeRound(round));
    }),
);

// GET /api/worker-status?tournamentId=:id
router.get(
    '/worker-status',
    asyncHandler(async (req: Request, res: Response) => {
        const tid = Number(req.query['tournamentId']);
        if (!tid) {
            res.status(400).json({ error: 'tournamentId required' });
            return;
        }
        if (await rejectTestTournamentInProduction(tid, res, (req as AuthenticatedRequest).user)) {
            return;
        }

        const state = await prisma.workerState.findUnique({ where: { tournamentId: tid } });

        if (!state) {
            const body: WorkerStatus = {
                isRunning: false,
                lastSync: null,
                error: null,
                pfJwtExpiresAt: null,
            };
            res.json(body);
            return;
        }

        // JWT expiry comes from pf_session singleton (metadata only — token never stored)
        const pfSession = await prisma.pfSession.findUnique({ where: { id: 1 } });

        const rawSync = state.lastMatchesFetchedAt ?? state.lastRoundsFetchedAt ?? null;
        const body: WorkerStatus = {
            isRunning: state.isRunning,
            lastSync: rawSync?.toISOString() ?? null,
            error: state.lastError,
            pfJwtExpiresAt: pfSession?.expiresAt?.toISOString() ?? null,
        };

        res.json(body);
    }),
);

// GET /api/data/:table?tournamentId=:id&limit=50&offset=0

const TABLE_MODEL_MAP: Record<string, string> = {
    rounds: 'round',
    matches: 'match',
    drops: 'drop',
    extensions: 'extension',
    penalties: 'penalty',
    coverage: 'tableCoverage',
    judge_calls: 'tableJudgeCall',
};

router.get(
    '/data/:table',
    asyncHandler(async (req: Request, res: Response) => {
        const user = (req as AuthenticatedRequest).user;
        if (user.role !== 'admin' && user.role !== 'superadmin') {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const tableName = String(req.params['table'] ?? '');
        const modelName = TABLE_MODEL_MAP[tableName];
        if (!modelName) {
            res.status(404).json({ error: `Unknown table: ${tableName}` });
            return;
        }

        const tid = Number(req.query['tournamentId']);
        if (!tid) {
            res.status(400).json({ error: 'tournamentId required' });
            return;
        }
        if (await rejectTestTournamentInProduction(tid, res, (req as AuthenticatedRequest).user)) {
            return;
        }

        const limit = Math.min(Number(req.query['limit'] ?? 50), 200);
        const offset = Number(req.query['offset'] ?? 0);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        const delegate = (prisma as any)[modelName] as {
            findMany: (args: Prisma.RoundFindManyArgs) => Promise<unknown[]>;
            count: (args: { where: Record<string, unknown> }) => Promise<number>;
        };

        const where = { tournamentId: tid };
        const [rows, total] = await Promise.all([
            delegate.findMany({ where, take: limit, skip: offset, orderBy: { id: 'asc' } }),
            delegate.count({ where }),
        ]);

        res.json({ rows, total, limit, offset });
    }),
);

// GET /api/fixed-seating?tournamentId=:id[&roundNumber=:n]
// Live report: fixed-seat registrations cross-referenced with current round pairings from Carde.
router.get(
    '/fixed-seating',
    asyncHandler(async (req: Request, res: Response) => {
        const tid = Number(req.query['tournamentId']);
        if (!tid) {
            res.status(400).json({ error: 'tournamentId required' });
            return;
        }
        if (await rejectTestTournamentInProduction(tid, res, (req as AuthenticatedRequest).user)) {
            return;
        }

        const mapping = await prisma.tournamentSourceMapping.findFirst({
            where: { tournamentId: tid, source: 'carde', isEnabled: true },
        });
        if (!mapping) {
            res.status(400).json({ error: 'Tournament has no active Carde source' });
            return;
        }
        const cardeEventId = Number(mapping.externalId);

        const requestedRound = req.query['roundNumber'] ? Number(req.query['roundNumber']) : null;
        const round = requestedRound
            ? await prisma.round.findFirst({ where: { tournamentId: tid, roundNumber: requestedRound } })
            : await prisma.round.findFirst({
                  where: { tournamentId: tid, cardeStatus: { in: ['IN_PROGRESS', 'COMPLETE'] } },
                  orderBy: { roundNumber: 'desc' },
              });

        if (!round) {
            const body: FixedSeatingResponse = { roundNumber: null, entries: [] };
            res.json(body);
            return;
        }

        let registrations: Awaited<ReturnType<typeof fetchCardeFixedSeatRegistrations>>;
        let matches: Awaited<ReturnType<typeof fetchCardeAllRoundMatches>>;
        try {
            [registrations, matches] = await Promise.all([
                fetchCardeFixedSeatRegistrations(cardeEventId),
                fetchCardeAllRoundMatches(round.cardeRoundId),
            ]);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(502).json({ error: `Carde fetch failed: ${msg}` });
            return;
        }

        // Build userId → match info lookup
        const matchByUserId = new Map<number, { tableNumber: number; opponentName: string | null; isBye: boolean }>();
        for (const m of matches) {
            const pmrs = m.player_match_relationships ?? [];
            for (let i = 0; i < Math.min(pmrs.length, 2); i++) {
                const uid = pmrs[i]?.user_event_status?.user?.id;
                if (uid === null || uid === undefined) continue;
                const opp = pmrs[1 - i];
                const oppName = m.match_is_bye
                    ? null
                    : (opp?.user_event_status?.user_identifier ??
                       opp?.user_event_status?.user?.best_identifier ??
                       null);
                matchByUserId.set(uid, {
                    tableNumber: m.table_number,
                    opponentName: oppName,
                    isBye: m.match_is_bye,
                });
            }
        }

        const entries: FixedSeatEntry[] = registrations
            .filter((r) => r.registration_status === 'COMPLETE' && r.fixed_seat !== null)
            .map((r) => {
                const match = matchByUserId.get(r.user.id);
                const currentTable = match?.tableNumber ?? null;
                return {
                    playerName: r.user.first_last || r.user_identifier,
                    fixedSeat: r.fixed_seat as number,
                    currentTable,
                    opponentName: match?.opponentName ?? null,
                    isBye: match?.isBye ?? false,
                    moved: currentTable !== null && currentTable !== r.fixed_seat,
                };
            })
            .sort((a, b) => a.fixedSeat - b.fixedSeat);

        const body: FixedSeatingResponse = { roundNumber: round.roundNumber, entries };
        res.json(body);
    }),
);

function entryTime(e: Record<string, unknown>): number {
    const d = e['createdAt'] ?? e['firstSeenAt'];
    // Entries with no timestamp (e.g. legacy drops) sort to the end rather than the beginning
    // so they don't crowd out timestamped entries at the top of the log.
    return typeof d === 'string' ? new Date(d).getTime() : Infinity;
}

export { router as tournamentsRouter };
