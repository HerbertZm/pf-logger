import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { asyncHandler } from '../middleware/asyncHandler';
import { AuthenticatedRequest } from '../middleware/auth';
import type {
  Tournament, ActiveRoundResponse, LogsResponse, RoundSummary, WorkerStatus,
} from '../api/types';
import {
  serializeRound, serializeDrop, serializeExtension, serializePenalty,
  serializeCoverage, serializeJudgeCall,
} from './serializers';

const router = Router();

// GET /api/tournaments
router.get('/tournaments', asyncHandler(async (_req: Request, res: Response) => {
  const tournaments = await prisma.appTournament.findMany({
    where: { deletedAt: null },
    include: { sourceMappings: true },
    orderBy: { createdAt: 'desc' },
  });

  const body: Tournament[] = tournaments.map((t) => ({
    id: t.id,
    name: t.name,
    shortName: t.shortName,
    isActive: t.isActive,
    isEnded: t.isEnded,
    sources: {
      pf: t.sourceMappings.some((m) => m.source === 'purplefox' && m.isEnabled),
      carde: t.sourceMappings.some((m) => m.source === 'carde' && m.isEnabled),
    },
  }));

  res.json(body);
}));

// GET /api/dashboard/active-round?tournamentId=:id
router.get('/dashboard/active-round', asyncHandler(async (req: Request, res: Response) => {
  const tid = Number(req.query['tournamentId']);
  if (!tid) { res.status(400).json({ error: 'tournamentId required' }); return; }

  const round = await prisma.round.findFirst({
    where: {
      tournamentId: tid,
      cardeStatus: { in: ['IN_PROGRESS', 'COMPLETE'] },
    },
    orderBy: { roundNumber: 'desc' },
  });

  if (!round) { res.json(null); return; }

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
}));

// GET /api/logs?tournamentId=:id
router.get('/logs', asyncHandler(async (req: Request, res: Response) => {
  const tid = Number(req.query['tournamentId']);
  if (!tid) { res.status(400).json({ error: 'tournamentId required' }); return; }

  const [rounds, drops, extensions, penalties, coverage, judgeCalls] = await Promise.all([
    prisma.round.findMany({ where: { tournamentId: tid }, orderBy: { roundNumber: 'asc' } }),
    prisma.drop.findMany({ where: { tournamentId: tid }, orderBy: { id: 'asc' } }),
    prisma.extension.findMany({ where: { tournamentId: tid }, orderBy: { createdAt: 'asc' } }),
    prisma.penalty.findMany({ where: { tournamentId: tid }, orderBy: { createdAt: 'asc' } }),
    prisma.tableCoverage.findMany({ where: { tournamentId: tid }, orderBy: { firstSeenAt: 'asc' } }),
    prisma.tableJudgeCall.findMany({ where: { tournamentId: tid }, orderBy: { firstSeenAt: 'asc' } }),
  ]);

  const entries: LogsResponse['entries'] = [
    ...drops.map((d) => ({ type: 'drop' as const, ...serializeDrop(d) })),
    ...extensions.map((e) => ({ type: 'extension' as const, ...serializeExtension(e) })),
    ...penalties.map((p) => ({ type: 'penalty' as const, ...serializePenalty(p) })),
    ...coverage.map((c) => ({ type: 'coverage' as const, ...serializeCoverage(c) })),
    ...judgeCalls.map((j) => ({ type: 'judge_call' as const, ...serializeJudgeCall(j) })),
  ].sort((a, b) => entryTime(a) - entryTime(b));

  const body: LogsResponse = {
    rounds: rounds.map(serializeRound),
    entries,
  };

  res.json(body);
}));

// GET /api/insights?tournamentId=:id
router.get('/insights', asyncHandler(async (req: Request, res: Response) => {
  const tid = Number(req.query['tournamentId']);
  if (!tid) { res.status(400).json({ error: 'tournamentId required' }); return; }

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
        round.missingTablesJson != null
          ? (round.missingTablesJson as number[]).length
          : 0;

      // overtimeMinutes: not computable from completedAt — that field equals next round's
      // started_at for Swiss rounds. Requires a dedicated ingestion-time snapshot. Left null
      // until the worker captures a real overtime signal.
      const overtimeMinutes: null = null;

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
}));

// GET /api/worker-status?tournamentId=:id
router.get('/worker-status', asyncHandler(async (req: Request, res: Response) => {
  const tid = Number(req.query['tournamentId']);
  if (!tid) { res.status(400).json({ error: 'tournamentId required' }); return; }

  const state = await prisma.workerState.findUnique({ where: { tournamentId: tid } });

  if (!state) {
    const body: WorkerStatus = { isRunning: false, lastSync: null, error: null, pfJwtExpiresAt: null };
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
}));

// GET /api/data/:table?tournamentId=:id&limit=50&offset=0

const TABLE_MODEL_MAP: Record<string, string> = {
  rounds:      'round',
  matches:     'match',
  drops:       'drop',
  extensions:  'extension',
  penalties:   'penalty',
  coverage:    'tableCoverage',
  judge_calls: 'tableJudgeCall',
};

router.get('/data/:table', asyncHandler(async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    res.status(403).json({ error: 'Forbidden' }); return;
  }

  const tableName = req.params['table'] ?? '';
  const modelName = TABLE_MODEL_MAP[tableName];
  if (!modelName) {
    res.status(404).json({ error: `Unknown table: ${tableName}` }); return;
  }

  const tid = Number(req.query['tournamentId']);
  if (!tid) { res.status(400).json({ error: 'tournamentId required' }); return; }

  const limit = Math.min(Number(req.query['limit'] ?? 50), 200);
  const offset = Number(req.query['offset'] ?? 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
}));

function entryTime(e: Record<string, unknown>): number {
  const d = (e['createdAt'] ?? e['firstSeenAt']);
  return typeof d === 'string' ? new Date(d).getTime() : 0;
}

export { router as tournamentsRouter };
