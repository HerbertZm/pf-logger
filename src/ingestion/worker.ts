import { prisma } from '../db/prisma';
import { fetchCardeRounds, fetchCardeMatches } from './providers/carde';
import { fetchPfData } from './providers/purplefox';

const CARDE_POLL_INTERVAL_MS = 30_000;
const PF_POLL_INTERVAL_MS = 15_000;

/**
 * Starts the background ingestion worker for all active tournaments.
 * Runs independently of the HTTP server — a crash here does not take down the API.
 *
 * Ingestion strategy:
 * - Carde: polls every ~30s using status=in_progress&page_size=200 (never fetches full match lists)
 * - PurpleFox: polls every ~15s; skips if no JWT in memory
 * - At timer_end_datetime, immediately snapshots outstanding matches into rounds.missing_tables_json
 */
export async function startWorker(): Promise<void> {
  console.warn('[worker] starting ingestion worker');

  const activeTournaments = await prisma.appTournament.findMany({
    where: { isActive: true, isEnded: false },
    include: { sourceMappings: true },
  });

  for (const tournament of activeTournaments) {
    runTournamentWorker(tournament.id).catch((err) => {
      console.error(`[worker] tournament ${tournament.id} failed to start:`, err);
    });
  }
}

async function runTournamentWorker(tournamentId: number): Promise<void> {
  console.warn(`[worker] starting worker for tournament ${tournamentId}`);

  await prisma.workerState.upsert({
    where: { tournamentId },
    create: { tournamentId, isRunning: true },
    update: { isRunning: true, lastError: null },
  });

  // TODO: P0.4 — implement full poll cycle
  // - fetch rounds via fetchCardeRounds(), upsert raw_carde_rounds, derive normalized rounds
  // - fetch in-progress matches via fetchCardeMatches(roundId), upsert raw_carde_matches
  // - at timer_end_datetime, snapshot outstanding → rounds.missing_tables_json
  // - subscribe to PF real-time or poll via fetchPfData()

  const _roundsInterval = setInterval(() => {
    syncCardeRounds(tournamentId).catch(async (err) => {
      await prisma.workerState.update({
        where: { tournamentId },
        data: { lastError: String(err) },
      }).catch(() => {});
    });
  }, CARDE_POLL_INTERVAL_MS);

  const _pfInterval = setInterval(() => {
    syncPfData(tournamentId).catch(async (err) => {
      await prisma.workerState.update({
        where: { tournamentId },
        data: { lastError: String(err) },
      }).catch(() => {});
    });
  }, PF_POLL_INTERVAL_MS);
}

async function syncCardeRounds(tournamentId: number): Promise<void> {
  // TODO: P0.4
  void tournamentId;
}

async function syncPfData(tournamentId: number): Promise<void> {
  // TODO: P0.4
  void tournamentId;
}

// Compute timer_end_datetime locally — never read from API.
// Carde has no round-level extra time field; adjustments are absorbed into the event-level
// timer_end_datetime on detail/, which we don't use. Compute from round duration only.
export function computeTimerEnd(startedAt: Date, timerDurationMin: number): Date {
  return new Date(startedAt.getTime() + timerDurationMin * 60 * 1000);
}
