import { prisma } from '../db/prisma';
import { fetchCardeRounds, fetchCardeMatches } from './providers/carde';
import { fetchPfData, parseExtensionAction, type PfData } from './providers/purplefox';
import { getPfJwt } from './jwtStore';

const CARDE_POLL_INTERVAL_MS = 30_000;
const PF_POLL_INTERVAL_MS = 15_000;

/**
 * Starts the background ingestion worker for all active tournaments.
 * Runs independently of the HTTP server — a crash here does not take down the API.
 *
 * Ingestion strategy:
 * - Carde: polls every ~30s using status=in_progress&page_size=200 (never fetches full match lists)
 * - PurpleFox: polls every ~15s; skips silently if no JWT in memory
 * - At timer_end_datetime, immediately snapshots outstanding matches into rounds.missing_tables_json
 */
export async function startWorker(): Promise<void> {
  console.warn('[worker] starting ingestion worker');

  const activeTournaments = await prisma.appTournament.findMany({
    where: { isActive: true, isEnded: false, deletedAt: null },
    include: { sourceMappings: true },
  });

  for (const tournament of activeTournaments) {
    spawnTournamentWorker(tournament.id).catch((err) => {
      console.error(`[worker] tournament ${tournament.id} failed to start:`, err);
    });
  }
}

/** Start polling loops for a single tournament. Exported so new tournaments can be wired up. */
export function spawnTournamentWorker(tournamentId: number): Promise<void> {
  return prisma.workerState.upsert({
    where: { tournamentId },
    create: { tournamentId, isRunning: true },
    update: { isRunning: true, lastError: null },
  }).then(() => {
    console.warn(`[worker] polling started for tournament ${tournamentId}`);

    setInterval(() => {
      syncCardeRounds(tournamentId).catch((err) => recordError(tournamentId, err));
    }, CARDE_POLL_INTERVAL_MS);

    setInterval(() => {
      syncPfData(tournamentId).catch((err) => recordError(tournamentId, err));
    }, PF_POLL_INTERVAL_MS);

    // Run immediately on startup
    syncCardeRounds(tournamentId).catch((err) => recordError(tournamentId, err));
    syncPfData(tournamentId).catch((err) => recordError(tournamentId, err));
  });
}

async function recordError(tournamentId: number, err: unknown): Promise<void> {
  console.error(`[worker] tournament ${tournamentId} error:`, err);
  await prisma.workerState.update({
    where: { tournamentId },
    data: { lastError: String(err), updatedAt: new Date() },
  }).catch(() => {});
}

// ─── Carde sync ───────────────────────────────────────────────────────────────

export async function syncCardeRounds(tournamentId: number): Promise<void> {
  const mapping = await prisma.tournamentSourceMapping.findFirst({
    where: { tournamentId, source: 'carde', isEnabled: true },
  });
  if (!mapping) return;

  const cardeEventId = Number(mapping.externalId);
  const rounds = await fetchCardeRounds(cardeEventId);

  for (const r of rounds) {
    // Append to raw layer
    await prisma.rawCardeRound.create({
      data: {
        fetchedAt: new Date(),
        tournamentId,
        cardeEventId,
        cardeRoundId: r.id,
        roundNumber: r.round_number,
        startedAt: r.started_at ? new Date(r.started_at) : null,
        completedAt: r.completed_at ? new Date(r.completed_at) : null,
        timerDurationMin: r.timer_duration_minutes ?? null,
        cardeStatus: r.status,
        pairingsStatus: r.pairings_status ?? null,
        rawPayload: r as object,
      },
    });

    // Derive normalized round (write-once semantics for timestamp fields)
    const startedAt = r.started_at ? new Date(r.started_at) : null;
    const timerEnd = (startedAt && r.timer_duration_minutes != null)
      ? computeTimerEnd(startedAt, r.timer_duration_minutes)
      : null;

    const existing = await prisma.round.findUnique({
      where: { tournamentId_roundNumber: { tournamentId, roundNumber: r.round_number } },
    });

    await prisma.round.upsert({
      where: { tournamentId_roundNumber: { tournamentId, roundNumber: r.round_number } },
      create: {
        tournamentId,
        roundNumber: r.round_number,
        phase: 'swiss',         // Top-8 detection deferred to P1
        cardeRoundId: r.id,
        cardeStatus: r.status,
        startedAt,
        timerDurationMin: r.timer_duration_minutes ?? null,
        timerEndDatetime: timerEnd,
        completedAt: r.completed_at ? new Date(r.completed_at) : null,
      },
      update: {
        cardeStatus: r.status,
        // write-once: don't overwrite a timestamp we've already stored
        startedAt: existing?.startedAt ?? startedAt,
        completedAt: existing?.completedAt ?? (r.completed_at ? new Date(r.completed_at) : null),
        // timer_duration_min can change if TO resets timer; recompute timer_end accordingly
        timerDurationMin: r.timer_duration_minutes ?? existing?.timerDurationMin ?? null,
        timerEndDatetime: timerEnd ?? existing?.timerEndDatetime ?? null,
      },
    });

    // Fetch in-progress matches for the active round
    if (r.status === 'IN_PROGRESS') {
      await syncCardeMatches(tournamentId, r.id, r.round_number, mapping).catch(
        (err) => console.error(`[worker] match sync failed for round ${r.id}:`, err),
      );
    }
  }

  // Set cardeFirstRoundId on the mapping if not yet set
  if (!mapping.cardeFirstRoundId) {
    const round1 = rounds.find((r) => r.round_number === 1);
    if (round1) {
      await prisma.tournamentSourceMapping.update({
        where: { id: mapping.id },
        data: { cardeFirstRoundId: round1.id },
      });
    }
  }

  await prisma.workerState.update({
    where: { tournamentId },
    data: {
      lastRoundsFetchedAt: new Date(),
      currentRound: rounds.find((r) => r.status === 'IN_PROGRESS')?.round_number ?? null,
      lastError: null,
      updatedAt: new Date(),
    },
  });
}

async function syncCardeMatches(
  tournamentId: number,
  cardeRoundId: number,
  roundNumber: number,
  mapping: { externalId: string },
): Promise<void> {
  const matches = await fetchCardeMatches(cardeRoundId);

  const round = await prisma.round.findFirst({
    where: { tournamentId, cardeRoundId },
  });
  if (!round) return;

  // Is PF the extension source (PF+Carde mode)?
  const pfEnabled = await prisma.tournamentSourceMapping.findFirst({
    where: { tournamentId, source: 'purplefox', isEnabled: true },
  });

  for (const m of matches) {
    if (m.table_number === -1) continue; // byes — never count as outstanding

    // Append to raw layer
    await prisma.rawCardeMatch.create({
      data: {
        fetchedAt: new Date(),
        tournamentId,
        cardeRoundId,
        roundNumber,
        tableNumber: m.table_number,
        cardeMatchId: m.id,
        status: m.status,
        // In PF+Carde mode: time_extension_seconds is always 0 from Carde; PF is the source
        // In Carde-only mode: use what Carde reports
        timeExtensionSec: pfEnabled ? 0 : m.time_extension_seconds,
        isGhostMatch: m.is_ghost_match,
        isBye: m.is_bye,
        matchIsLoss: m.match_is_loss,
        matchIsIntentionalDraw: m.match_is_intentional_draw,
        matchIsUnintentionalDraw: m.match_is_unintentional_draw,
        deckCheckStarted: m.deck_check_started,
        deckCheckCompleted: m.deck_check_completed,
        assignedJudge: m.assigned_judge,
        resultReportedAt: m.result_reported_at ? new Date(m.result_reported_at) : null,
        updatedAt: new Date(m.updated_at),
        p1UserId: m.p1_user_id,
        p1Name: m.p1_name,
        p2UserId: m.p2_user_id,
        p2Name: m.p2_name,
        winningPlayerId: m.winning_player_id,
        rawPayload: m as object,
      },
    });

    // Derive normalized match
    const resultAt = m.result_reported_at
      ? new Date(m.result_reported_at)
      : new Date(m.updated_at);

    await prisma.match.upsert({
      where: { tournamentId_roundNumber_tableNumber: { tournamentId, roundNumber, tableNumber: m.table_number } },
      create: {
        tournamentId,
        roundId: round.id,
        roundNumber,
        tableNumber: m.table_number,
        cardeMatchId: m.id,
        status: m.status,
        timeExtensionSec: pfEnabled ? 0 : m.time_extension_seconds,
        isGhostMatch: m.is_ghost_match,
        isBye: m.is_bye,
        matchIsLoss: m.match_is_loss,
        matchIsIntentionalDraw: m.match_is_intentional_draw,
        matchIsUnintentionalDraw: m.match_is_unintentional_draw,
        deckCheckStarted: m.deck_check_started,
        deckCheckCompleted: m.deck_check_completed,
        assignedJudge: m.assigned_judge,
        resultReportedAt: m.result_reported_at ? new Date(m.result_reported_at) : null,
        resultAt,
        p1UserId: m.p1_user_id,
        p1Name: m.p1_name,
        p2UserId: m.p2_user_id,
        p2Name: m.p2_name,
        winningPlayerId: m.winning_player_id,
      },
      update: {
        status: m.status,
        timeExtensionSec: pfEnabled ? 0 : m.time_extension_seconds,
        isGhostMatch: m.is_ghost_match,
        matchIsIntentionalDraw: m.match_is_intentional_draw,
        matchIsUnintentionalDraw: m.match_is_unintentional_draw,
        deckCheckStarted: m.deck_check_started,
        deckCheckCompleted: m.deck_check_completed,
        assignedJudge: m.assigned_judge,
        resultReportedAt: m.result_reported_at ? new Date(m.result_reported_at) : null,
        resultAt,
        winningPlayerId: m.winning_player_id,
      },
    });
  }

  await prisma.workerState.update({
    where: { tournamentId },
    data: { lastMatchesFetchedAt: new Date(), updatedAt: new Date() },
  });

  // Snapshot outstanding tables at timer expiry
  await maybeSnapshotOutstanding(tournamentId, round.id, mapping);
}

async function maybeSnapshotOutstanding(
  tournamentId: number,
  roundId: number,
  _mapping: { externalId: string },
): Promise<void> {
  const round = await prisma.round.findUnique({ where: { id: roundId } });
  if (!round?.timerEndDatetime || round.snapshotCapturedAt) return;

  const now = new Date();
  if (now < round.timerEndDatetime) return; // timer not yet expired

  // Timer has expired — take snapshot of outstanding (non-bye, in-progress) tables
  const outstanding = await prisma.match.findMany({
    where: { tournamentId, roundId, status: 'IN_PROGRESS', isBye: false },
    select: { tableNumber: true },
  });

  await prisma.round.update({
    where: { id: roundId },
    data: {
      missingTablesJson: outstanding.map((m) => m.tableNumber),
      snapshotCapturedAt: now,
    },
  });

  console.warn(
    `[worker] snapshot captured for round ${round.roundNumber}: ${outstanding.length} outstanding tables`,
  );
}

// ─── PurpleFox sync ───────────────────────────────────────────────────────────

export async function syncPfData(tournamentId: number): Promise<void> {
  const mapping = await prisma.tournamentSourceMapping.findFirst({
    where: { tournamentId, source: 'purplefox', isEnabled: true },
  });
  if (!mapping) return; // Carde-only mode

  const jwt = getPfJwt();
  if (!jwt) {
    // No JWT in memory — log once and skip silently
    await prisma.workerState.update({
      where: { tournamentId },
      data: { lastError: 'PF JWT not in memory — re-paste required', updatedAt: new Date() },
    }).catch(() => {});
    return;
  }

  const pfTournamentId = mapping.externalId;
  const data = await fetchPfData(pfTournamentId, jwt);

  await Promise.all([
    normalizeDrops(tournamentId, pfTournamentId, data),
    normalizeExtensions(tournamentId, pfTournamentId, data),
    normalizePenalties(tournamentId, pfTournamentId, data),
    normalizeJudgeCalls(tournamentId, pfTournamentId, data),
  ]);

  await prisma.workerState.update({
    where: { tournamentId },
    data: { lastPfFetchedAt: new Date(), lastError: null, updatedAt: new Date() },
  });
}

async function normalizeDrops(
  tournamentId: number,
  pfTournamentId: string,
  data: PfData,
): Promise<void> {
  for (const d of data.drops) {
    if (d.round == null) continue; // drop without a round — skip

    // Append to raw layer
    await prisma.rawPfDrop.create({
      data: {
        fetchedAt: new Date(),
        tournamentId,
        pfTournamentId,
        playerGameId: d.playerGameId,
        round: d.round,
        tableNumber: d.tableNumber,
        playerName: d.playerName,
        isChecked: d.isChecked,
        isCancelled: d.isCancelled,
        updatedBy: d.updated_by,
        rawPayload: d as object,
      },
    });

    // Normalize with write-once semantics
    const existing = await prisma.drop.findUnique({
      where: { tournamentId_playerGameId_round: { tournamentId, playerGameId: d.playerGameId, round: d.round } },
    });

    await prisma.drop.upsert({
      where: { tournamentId_playerGameId_round: { tournamentId, playerGameId: d.playerGameId, round: d.round } },
      create: {
        tournamentId,
        playerGameId: d.playerGameId,
        round: d.round,
        tableNumber: d.tableNumber,
        playerName: d.playerName,
        isChecked: d.isChecked,
        isCancelled: d.isCancelled,
        addedByName: d.updated_by_name ?? null,  // write-once: set on first sync
        updatedBy: d.updated_by ?? null,
        source: 'purplefox',
      },
      update: {
        tableNumber: d.tableNumber,
        playerName: d.playerName,
        isChecked: d.isChecked,
        isCancelled: d.isCancelled,
        updatedBy: d.updated_by ?? null,
        // write-once: preserve the name from first sync; don't overwrite
        addedByName: existing?.addedByName ?? d.updated_by_name ?? null,
        // set verified_by_name only when is_checked transitions false → true
        verifiedByName: (!existing?.isChecked && d.isChecked)
          ? (d.updated_by_name ?? null)
          : (existing?.verifiedByName ?? null),
      },
    });
  }
}

async function normalizeExtensions(
  tournamentId: number,
  pfTournamentId: string,
  data: PfData,
): Promise<void> {
  for (const e of data.extensions) {
    const { fromMinutes, toMinutes } = parseExtensionAction(e.action);
    const extensionMinutes =
      fromMinutes != null && toMinutes != null ? toMinutes - fromMinutes : null;

    // Look up normalized round_id from our rounds table
    const round = e.round != null
      ? await prisma.round.findFirst({ where: { tournamentId, roundNumber: e.round } })
      : null;

    // Append to raw layer
    await prisma.rawPfExtension.create({
      data: {
        fetchedAt: new Date(),
        tournamentId,
        pfTournamentId,
        pfId: e.id,
        tableNumber: e.tableNumber,
        round: e.round,
        action: e.action,
        fromMinutes,
        toMinutes,
        userId: e.userId,
        createdAt: new Date(e.createdAt),
        rawPayload: e as object,
      },
    });

    // Upsert normalized extension (keyed on pfId — stable across syncs)
    await prisma.extension.upsert({
      where: { pfId_tournamentId: { pfId: String(e.id), tournamentId } },
      create: {
        tournamentId,
        roundId: round?.id ?? null,
        round: e.round,
        tableNumber: e.tableNumber,
        fromMinutes,
        toMinutes,
        extensionMinutes,
        actionText: e.action,
        userId: e.userId,
        createdAt: new Date(e.createdAt),
        source: 'purplefox',
      },
      update: {
        // Extensions are immutable once created in PF; nothing to update
        // but keep round_id in sync if it was NULL on first sync
        ...(round?.id !== undefined && { roundId: round.id }),
      },
    });
  }
}

async function normalizePenalties(
  tournamentId: number,
  pfTournamentId: string,
  data: PfData,
): Promise<void> {
  for (const p of data.penalties) {
    // Append to raw layer
    await prisma.rawPfPenalty.create({
      data: {
        fetchedAt: new Date(),
        tournamentId,
        pfTournamentId,
        pfId: p.id,
        round: p.round,
        playerGameId: p.playerGameId,
        playerName: p.playerName,
        description: p.description,
        infraction: p.type,        // PF field is "type"; we store as "infraction"
        sanction: p.sanction,
        createdAt: new Date(p.createdAt + 'Z'), // no tz suffix from PF — append Z for UTC
        creatorId: p.creator_id,
        creatorName: p.creator_name,
        rawPayload: p as object,
      },
    });

    // Upsert normalized penalty
    await prisma.penalty.upsert({
      where: { pfId_tournamentId: { pfId: p.id, tournamentId } },
      create: {
        tournamentId,
        pfId: p.id,
        round: p.round,
        playerGameId: p.playerGameId,
        playerName: p.playerName,
        description: p.description ?? '',
        infraction: p.type,
        sanction: p.sanction,
        createdAt: new Date(p.createdAt + 'Z'),
        creatorId: p.creator_id,
        creatorName: p.creator_name,
        source: 'purplefox',
      },
      update: {
        // Penalties are immutable once written in PF
        // No update needed; upsert handles deduplication
      },
    });
  }
}

async function normalizeJudgeCalls(
  tournamentId: number,
  pfTournamentId: string,
  data: PfData,
): Promise<void> {
  const currentRound = data.currentRound;
  if (currentRound == null) return; // can't annotate without round number

  for (const jc of data.judgeCalls) {
    // Append to raw layer
    await prisma.rawPfJudgeCall.create({
      data: {
        fetchedAt: new Date(),
        tournamentId,
        pfTournamentId,
        tableNumber: jc.tableNumber,
        round: currentRound,
        judgeResult: jc.judgeResult,
        firstSeenAt: new Date(),
        rawPayload: jc as object,
      },
    });

    // Upsert normalized judge call (unique on tournament + table + round)
    const existing = await prisma.tableJudgeCall.findUnique({
      where: { tournamentId_tableNumber_round: { tournamentId, tableNumber: jc.tableNumber, round: currentRound } },
    });

    await prisma.tableJudgeCall.upsert({
      where: { tournamentId_tableNumber_round: { tournamentId, tableNumber: jc.tableNumber, round: currentRound } },
      create: {
        tournamentId,
        round: currentRound,
        tableNumber: jc.tableNumber,
        judgeResult: jc.judgeResult,
        firstSeenAt: new Date(),
      },
      update: {
        // judgeResult may be updated if judge amends their call; always reflect latest
        judgeResult: jc.judgeResult,
        // firstSeenAt is write-once — preserve original
        firstSeenAt: existing?.firstSeenAt ?? new Date(),
      },
    });
  }
}

// ─── Timer ────────────────────────────────────────────────────────────────────

// Compute timer_end_datetime locally — never read from API.
// Carde has no round-level extra time field; adjustments are absorbed into the event-level
// timer_end_datetime on detail/, which we don't use. Compute from round duration only.
export function computeTimerEnd(startedAt: Date, timerDurationMin: number): Date {
  return new Date(startedAt.getTime() + timerDurationMin * 60 * 1000);
}
