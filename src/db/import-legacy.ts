/**
 * P0.6 — Step 2: Import a legacy-export.json payload into PostgreSQL.
 *
 * Called by POST /api/admin/import. Never invoked directly.
 *
 * Idempotent: upserts and skipDuplicates throughout. Safe to re-run if interrupted.
 */
import { prisma } from './prisma';

// ─── Legacy SQLite row types ───────────────────────────────────────────────────

interface LegacyTournamentMeta {
  tournament_id: string;
  name: string;
  is_ended: number;
}

interface LegacyRoundTimer {
  tournament_id: string;
  round: number;
  carde_round_id: number;
  started_at: string | null;
  completed_at: string | null;
  timer_duration_minutes: number | null;
  carde_status: string | null;
  missing_tables_json: string | null;
  timer_end_datetime: string | null;
  extra_time_seconds?: number | null; // removed from new schema — ignored on import
}

interface LegacyDrop {
  tournament_id: string;
  player_game_id: string;
  round: number;
  table_number: number | null;
  player_name: string | null;
  is_checked: number;
  is_cancelled: number;
  updated_by: string | null;
  updated_by_name: string | null;
  added_by_name: string | null;
  verified_by_name: string | null;
}

interface LegacyPenalty {
  id: string;
  tournament_id: string;
  round: number | null;
  player_game_id: string | null;
  player_name: string | null;
  description: string;
  type: string | null;
  sanction: string | null;
  created_at: string;
  creator_id: string | null;
  creator_name: string | null;
}

interface LegacyTimeLog {
  id: number;
  tournament_id: string;
  round: number | null;
  table_number: number | null;
  action: string;
  user_id: string | null;
  created_at: string;
}

interface LegacyCoverage {
  tournament_id: string;
  table_number: number;
  covered_by: string;
  first_seen_at: string;
  round: number | null;
}

interface LegacyJudgeResult {
  tournament_id: string;
  table_number: number;
  judge_result: string;
  first_seen_at: string;
  judge: string | null;
  round: number | null;
}

interface LegacyUser {
  user_id: string;
  display_name: string;
}

// ─── Export payload shape ──────────────────────────────────────────────────────

export interface LegacyExport {
  version: 1;
  exportedAt: string;
  tournaments: LegacyTournamentMeta[];
  rounds: LegacyRoundTimer[];
  drops: LegacyDrop[];
  penalties: LegacyPenalty[];
  timeLogs: LegacyTimeLog[];
  coverage: LegacyCoverage[];
  judgeResults: LegacyJudgeResult[];
  users: LegacyUser[];
}

export interface ImportResult {
  created: {
    tournaments: number;
    rounds: number;
    drops: number;
    penalties: number;
    extensions: number;
    coverage: number;
    judgeCalls: number;
    activity: number;
  };
  skipped: {
    tournaments: number;
    rounds: number;
    dropsSkippedNoAppId: number;
    judgeCallsNullRound: number;
  };
  totalsInExport: {
    tournaments: number;
    rounds: number;
    drops: number;
    penalties: number;
    timeLogs: number;
    coverage: number;
    judgeResults: number;
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Normalize non-standard ISO timestamps (e.g. "2026-04-25T09:58-0400" → Date). */
function parseTs(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const normalized = raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

/** Parse "Change time from Xmin to Ymin" → { from, to, ext } */
function parseExtensionAction(action: string): { from: number; to: number; ext: number } | null {
  const m = action.match(/Change time from (\d+)min to (\d+)min/i);
  if (!m || !m[1] || !m[2]) return null;
  const from = parseInt(m[1], 10);
  const to = parseInt(m[2], 10);
  return { from, to, ext: to - from };
}

function roundKey(appTid: number, roundNum: number): string {
  return `${appTid}:${roundNum}`;
}

// ─── Main import function ──────────────────────────────────────────────────────

export async function importLegacy(payload: LegacyExport): Promise<ImportResult> {
  const {
    tournaments: metaRows,
    rounds: roundTimers,
    drops,
    penalties,
    timeLogs,
    coverage,
    judgeResults,
    users: usersRows,
  } = payload;

  const pfUserNames = new Map<string, string>(usersRows.map((u) => [u.user_id, u.display_name]));

  // Collect all tournament IDs referenced across every table
  const allTournamentIds = new Set<string>([
    ...metaRows.map((r) => r.tournament_id),
    ...drops.map((r) => r.tournament_id),
    ...penalties.map((r) => r.tournament_id),
    ...timeLogs.map((r) => r.tournament_id),
    ...coverage.map((r) => r.tournament_id),
    ...judgeResults.map((r) => r.tournament_id),
  ]);

  const metaByTid = new Map(metaRows.map((m) => [m.tournament_id, m]));

  // ── 1. AppTournament ───────────────────────────────────────────────────────

  const tidToAppId = new Map<string, number>();
  let tournamentsCreated = 0;
  let tournamentsSkipped = 0;

  for (const tid of allTournamentIds) {
    const meta = metaByTid.get(tid);
    const name = meta?.name ?? `Legacy Tournament (${tid.slice(0, 8)})`;
    const shortName = name.length > 32 ? name.slice(0, 32) : name;

    const existing = await prisma.tournamentSourceMapping.findFirst({
      where: { source: 'purplefox', externalId: tid },
    });

    if (existing) {
      tidToAppId.set(tid, existing.tournamentId);
      tournamentsSkipped++;
      continue;
    }

    const t = await prisma.appTournament.create({
      data: {
        name,
        shortName,
        isActive: false,
        isEnded: meta ? meta.is_ended === 1 : true,
      },
    });
    tidToAppId.set(tid, t.id);

    await prisma.tournamentSourceMapping.create({
      data: { tournamentId: t.id, source: 'purplefox', externalId: tid, isEnabled: false },
    });

    tournamentsCreated++;
  }

  // ── 2. Rounds ──────────────────────────────────────────────────────────────

  const roundIdMap = new Map<string, number>();
  let roundsCreated = 0;
  let roundsSkipped = 0;

  for (const rt of roundTimers) {
    const appId = tidToAppId.get(rt.tournament_id);
    if (appId === undefined) continue;

    const existing = await prisma.round.findUnique({
      where: { tournamentId_roundNumber: { tournamentId: appId, roundNumber: rt.round } },
    });
    if (existing) {
      roundIdMap.set(roundKey(appId, rt.round), existing.id);
      roundsSkipped++;
      continue;
    }

    const r = await prisma.round.create({
      data: {
        tournamentId: appId,
        roundNumber: rt.round,
        phase: 'swiss',
        cardeRoundId: rt.carde_round_id,
        cardeStatus: rt.carde_status,
        startedAt: parseTs(rt.started_at),
        timerDurationMin: rt.timer_duration_minutes,
        timerEndDatetime: parseTs(rt.timer_end_datetime),
        completedAt: parseTs(rt.completed_at),
        missingTablesJson: rt.missing_tables_json ? JSON.parse(rt.missing_tables_json) : null,
        snapshotCapturedAt: rt.missing_tables_json ? parseTs(rt.completed_at) : null,
      },
    });
    roundIdMap.set(roundKey(appId, rt.round), r.id);
    roundsCreated++;
  }

  // ── 3. Drops ───────────────────────────────────────────────────────────────

  let dropsSkippedNoAppId = 0;
  const dropsResult = await prisma.drop.createMany({
    data: drops.flatMap((d) => {
      const appId = tidToAppId.get(d.tournament_id);
      if (appId === undefined) { dropsSkippedNoAppId++; return []; }
      return [{
        tournamentId: appId,
        playerGameId: d.player_game_id,
        round: d.round,
        tableNumber: d.table_number,
        playerName: d.player_name,
        isChecked: d.is_checked === 1,
        isCancelled: d.is_cancelled === 1,
        addedByName: d.added_by_name,
        verifiedByName: d.verified_by_name,
        updatedBy: d.updated_by,
        source: 'purplefox',
      }];
    }),
    skipDuplicates: true,
  });

  // ── 4. Penalties ───────────────────────────────────────────────────────────

  const penaltiesResult = await prisma.penalty.createMany({
    data: penalties.flatMap((p) => {
      const appId = tidToAppId.get(p.tournament_id);
      if (appId === undefined) return [];
      return [{
        tournamentId: appId,
        pfId: p.id,
        round: p.round,
        playerGameId: p.player_game_id,
        playerName: p.player_name,
        description: p.description,
        infraction: p.type,
        sanction: p.sanction,
        createdAt: parseTs(p.created_at) ?? new Date(),
        creatorId: p.creator_id,
        creatorName: p.creator_name,
        source: 'purplefox',
      }];
    }),
    skipDuplicates: true,
  });

  // ── 5. Extensions (from time_logs) ────────────────────────────────────────

  const extData = timeLogs.flatMap((tl) => {
    const appId = tidToAppId.get(tl.tournament_id);
    if (appId === undefined || tl.table_number === null) return [];
    const parsed = parseExtensionAction(tl.action);
    if (!parsed) return [];
    const createdAt = parseTs(tl.created_at);
    if (!createdAt) return [];
    const roundId = tl.round !== null ? (roundIdMap.get(roundKey(appId, tl.round)) ?? null) : null;
    return [{
      tournamentId: appId,
      roundId,
      round: tl.round,
      tableNumber: tl.table_number,
      fromMinutes: parsed.from,
      toMinutes: parsed.to,
      extensionMinutes: parsed.ext,
      actionText: tl.action,
      userId: tl.user_id,
      createdAt,
      source: 'purplefox',
    }];
  });
  const extResult = await prisma.extension.createMany({ data: extData, skipDuplicates: false });

  // ── 6. Table Coverage ──────────────────────────────────────────────────────

  const covResult = await prisma.tableCoverage.createMany({
    data: coverage.flatMap((c) => {
      const appId = tidToAppId.get(c.tournament_id);
      if (appId === undefined) return [];
      const ts = parseTs(c.first_seen_at);
      if (!ts) return [];
      return [{
        tournamentId: appId,
        round: c.round,
        tableNumber: c.table_number,
        coveredBy: c.covered_by,
        firstSeenAt: ts,
      }];
    }),
    skipDuplicates: true,
  });

  // ── 7. Table Judge Calls ───────────────────────────────────────────────────

  let judgeCallsNullRound = 0;
  const judgeData = judgeResults.flatMap((j) => {
    const appId = tidToAppId.get(j.tournament_id);
    if (appId === undefined) return [];
    const ts = parseTs(j.first_seen_at);
    if (!ts) return [];
    if (j.round === null) { judgeCallsNullRound++; return []; }
    return [{
      tournamentId: appId,
      round: j.round,
      tableNumber: j.table_number,
      judge: j.judge,
      judgeResult: j.judge_result,
      firstSeenAt: ts,
    }];
  });
  const judgeResult = await prisma.tableJudgeCall.createMany({ data: judgeData, skipDuplicates: false });

  // ── 8. AppActivity (time_logs → audit trail) ───────────────────────────────

  const activityResult = await prisma.appActivity.createMany({
    data: timeLogs.flatMap((tl) => {
      const ts = parseTs(tl.created_at);
      if (!ts) return [];
      const displayName = tl.user_id ? (pfUserNames.get(tl.user_id) ?? tl.user_id) : 'unknown';
      return [{
        eventType: 'legacy:extension',
        username: displayName,
        detail: `[t:${tl.tournament_id.slice(0, 8)} r:${tl.round ?? '?'} tbl:${tl.table_number ?? '?'}] ${tl.action}`,
        createdAt: ts,
      }];
    }),
    skipDuplicates: false,
  });

  return {
    created: {
      tournaments: tournamentsCreated,
      rounds: roundsCreated,
      drops: dropsResult.count,
      penalties: penaltiesResult.count,
      extensions: extResult.count,
      coverage: covResult.count,
      judgeCalls: judgeResult.count,
      activity: activityResult.count,
    },
    skipped: {
      tournaments: tournamentsSkipped,
      rounds: roundsSkipped,
      dropsSkippedNoAppId,
      judgeCallsNullRound,
    },
    totalsInExport: {
      tournaments: metaRows.length,
      rounds: roundTimers.length,
      drops: drops.length,
      penalties: penalties.length,
      timeLogs: timeLogs.length,
      coverage: coverage.length,
      judgeResults: judgeResults.length,
    },
  };
}
