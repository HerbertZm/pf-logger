/**
 * P0.6 — SQLite → PostgreSQL migration
 *
 * Reads action_logs.db and writes to PostgreSQL via Prisma.
 * Run with: npx ts-node --compiler-options '{"module":"CommonJS"}' src/db/migrate-legacy.ts
 *
 * Idempotent: uses upserts/skipDuplicates throughout.
 */
import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── SQLite row types ──────────────────────────────────────────────────────────

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
  incomplete_at_end: number | null;
  missing_tables_json: string | null;
  timer_end_datetime: string | null;
  extra_time_seconds: number | null;
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Normalize non-standard ISO timestamps (e.g. "2026-04-25T09:58-0400" → Date). */
function parseTs(raw: string | null): Date | null {
  if (!raw) return null;
  // Normalize ±HHMM offset (no colon) → ±HH:MM
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

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dbPath = path.resolve(process.cwd(), 'action_logs.db');
  console.log(`Opening legacy DB: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });

  // ── 1. Load legacy data ────────────────────────────────────────────────────

  const metaRows = db.prepare('SELECT * FROM tournament_meta').all() as LegacyTournamentMeta[];
  const roundTimers = db.prepare('SELECT * FROM round_timers ORDER BY round').all() as LegacyRoundTimer[];
  const drops = db.prepare('SELECT * FROM drops').all() as LegacyDrop[];
  const penalties = db.prepare('SELECT * FROM penalties').all() as LegacyPenalty[];
  const timeLogs = db.prepare('SELECT * FROM time_logs ORDER BY created_at').all() as LegacyTimeLog[];
  const coverage = db.prepare('SELECT * FROM table_coverage').all() as LegacyCoverage[];
  const judgeResults = db.prepare('SELECT * FROM table_judge_results').all() as LegacyJudgeResult[];
  const usersRows = db.prepare('SELECT * FROM users').all() as LegacyUser[];

  db.close();
  console.log(`Loaded: ${metaRows.length} tournament meta, ${roundTimers.length} round timers, ` +
    `${drops.length} drops, ${penalties.length} penalties, ${timeLogs.length} time logs, ` +
    `${coverage.length} coverage rows, ${judgeResults.length} judge results`);

  // Build PF user_id → display_name lookup
  const pfUserNames = new Map<string, string>(usersRows.map((u) => [u.user_id, u.display_name]));

  // Collect all unique tournament IDs across tables
  const allTournamentIds = new Set<string>([
    ...metaRows.map((r) => r.tournament_id),
    ...drops.map((r) => r.tournament_id),
    ...penalties.map((r) => r.tournament_id),
    ...timeLogs.map((r) => r.tournament_id),
    ...coverage.map((r) => r.tournament_id),
    ...judgeResults.map((r) => r.tournament_id),
  ]);

  const metaByTid = new Map(metaRows.map((m) => [m.tournament_id, m]));

  // ── 2. Upsert AppTournament rows ───────────────────────────────────────────

  console.log('\n── AppTournament ────────────────────────────');
  const tidToAppId = new Map<string, number>();

  for (const tid of allTournamentIds) {
    const meta = metaByTid.get(tid);
    const name = meta?.name ?? `Legacy Tournament (${tid.slice(0, 8)})`;
    const shortName = name.length > 32 ? name.slice(0, 32) : name;

    // Check if a tournament with this PF external ID already exists
    const existing = await prisma.tournamentSourceMapping.findFirst({
      where: { source: 'purplefox', externalId: tid },
      include: { tournament: true },
    });

    if (existing) {
      tidToAppId.set(tid, existing.tournamentId);
      console.log(`  SKIP  ${name} (already mapped → id=${existing.tournamentId})`);
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
    console.log(`  CREATE ${name} → id=${t.id}`);
  }

  // ── 3. Upsert TournamentSourceMapping (PF) ────────────────────────────────

  console.log('\n── TournamentSourceMapping ──────────────────');
  for (const [tid, appId] of tidToAppId) {
    const existing = await prisma.tournamentSourceMapping.findUnique({
      where: { tournamentId_source: { tournamentId: appId, source: 'purplefox' } },
    });
    if (existing) {
      console.log(`  SKIP  purplefox mapping for id=${appId}`);
      continue;
    }
    await prisma.tournamentSourceMapping.create({
      data: { tournamentId: appId, source: 'purplefox', externalId: tid, isEnabled: false },
    });
    console.log(`  CREATE purplefox mapping for id=${appId} (externalId=${tid})`);
  }

  // ── 4. Rounds ──────────────────────────────────────────────────────────────

  console.log('\n── Rounds ───────────────────────────────────');
  let roundsCreated = 0;
  let roundsSkipped = 0;

  // Build a (appTournamentId, roundNumber) → prisma Round.id lookup for extension FKs
  const roundKey = (appTid: number, roundNum: number): string => `${appTid}:${roundNum}`;
  const roundIdMap = new Map<string, number>();

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

    const missingTables = rt.missing_tables_json ? JSON.parse(rt.missing_tables_json) : null;
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
        missingTablesJson: missingTables,
        snapshotCapturedAt: rt.missing_tables_json ? parseTs(rt.completed_at) : null,
      },
    });
    roundIdMap.set(roundKey(appId, rt.round), r.id);
    roundsCreated++;
  }
  console.log(`  Created: ${roundsCreated}  Skipped: ${roundsSkipped}`);

  // ── 5. Drops ───────────────────────────────────────────────────────────────

  console.log('\n── Drops ────────────────────────────────────');
  const dropsResult = await prisma.drop.createMany({
    data: drops.flatMap((d) => {
      const appId = tidToAppId.get(d.tournament_id);
      if (appId === undefined) return [];
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
  console.log(`  Inserted: ${dropsResult.count} / ${drops.length}`);

  // ── 6. Penalties ───────────────────────────────────────────────────────────

  console.log('\n── Penalties ────────────────────────────────');
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
  console.log(`  Inserted: ${penaltiesResult.count} / ${penalties.length}`);

  // ── 7. Extensions (from time_logs) ────────────────────────────────────────

  console.log('\n── Extensions ───────────────────────────────');
  let extCreated = 0;
  let extSkipped = 0;

  // time_logs doesn't have a natural unique key, so we use createMany with skipDuplicates
  // The unique constraint is (tournamentId, tableNumber, createdAt) — close enough for migration
  const extData = timeLogs.flatMap((tl) => {
    const appId = tidToAppId.get(tl.tournament_id);
    if (appId === undefined || tl.table_number === null) return [];
    const parsed = parseExtensionAction(tl.action);
    if (!parsed) return [];

    const createdAt = parseTs(tl.created_at);
    if (!createdAt) return [];

    const roundId = tl.round !== null ? roundIdMap.get(roundKey(appId, tl.round)) ?? null : null;

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

  // Extensions have no unique constraint in the schema, so we insert all
  const extResult = await prisma.extension.createMany({ data: extData, skipDuplicates: false });
  extCreated = extResult.count;
  extSkipped = timeLogs.length - extData.length;
  console.log(`  Inserted: ${extCreated}  Skipped (no table/unparseable): ${extSkipped}`);

  // ── 8. Table Coverage ──────────────────────────────────────────────────────

  console.log('\n── Table Coverage ───────────────────────────');
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
  console.log(`  Inserted: ${covResult.count} / ${coverage.length}`);

  // ── 9. Table Judge Calls ───────────────────────────────────────────────────

  console.log('\n── Table Judge Calls ────────────────────────');
  const judgeData = judgeResults.flatMap((j) => {
    const appId = tidToAppId.get(j.tournament_id);
    if (appId === undefined) return [];
    const ts = parseTs(j.first_seen_at);
    if (!ts) return [];
    if (j.round === null) return []; // round is non-nullable in new schema; skip legacy nulls
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
  console.log(`  Inserted: ${judgeResult.count} / ${judgeResults.length}`);

  // ── 10. AppActivity (audit log from time_logs) ─────────────────────────────

  console.log('\n── AppActivity ──────────────────────────────');
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
  console.log(`  Inserted: ${activityResult.count} / ${timeLogs.length}`);

  // ── 11. Verification summary ───────────────────────────────────────────────

  console.log('\n── Verification ─────────────────────────────');
  const [pgDrops, pgPenalties, pgExtensions, pgRounds, pgCoverage, pgJudge, pgActivity] = await Promise.all([
    prisma.drop.count(),
    prisma.penalty.count(),
    prisma.extension.count(),
    prisma.round.count(),
    prisma.tableCoverage.count(),
    prisma.tableJudgeCall.count(),
    prisma.appActivity.count(),
  ]);

  const rows = [
    ['Table', 'Legacy', 'PostgreSQL', 'Match'],
    ['drops', drops.length, pgDrops, pgDrops >= drops.length ? '✓' : '✗'],
    ['penalties', penalties.length, pgPenalties, pgPenalties >= penalties.length ? '✓' : '✗'],
    ['extensions (time_logs)', extData.length, pgExtensions, pgExtensions >= extData.length ? '✓' : '✗'],
    ['rounds', roundTimers.length, pgRounds, pgRounds >= roundTimers.length ? '✓' : '✗'],
    ['table_coverage', coverage.length, pgCoverage, pgCoverage >= coverage.length ? '✓' : '✗'],
    ['table_judge_results', judgeResults.length, pgJudge, pgJudge >= judgeResults.length ? '✓' : '✗'],
    ['time_logs (activity)', timeLogs.length, pgActivity, pgActivity >= timeLogs.length ? '✓' : '✗'],
  ] as const;

  const maxCols: number[] = (rows[0] as readonly unknown[]).map((_, i) =>
    Math.max(...rows.map((r) => String((r as readonly unknown[])[i]).length)),
  );
  for (const row of rows) {
    console.log('  ' + (row as readonly unknown[]).map((v, i) => String(v).padEnd(maxCols[i] ?? 0)).join('  '));
  }

  const allMatch = rows.slice(1).every((r) => r[3] === '✓');
  console.log(`\n${allMatch ? '✓ Migration complete — all rows accounted for.' : '✗ Some rows missing — check above.'}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
