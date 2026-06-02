/**
 * Seed a realistic test/dev tournament with pre-filled data.
 *
 * Creates:
 *  - 1 test tournament (isTestTournament=true, both PF+Carde sources)
 *  - 5 rounds: rounds 1–4 COMPLETE, round 5 IN_PROGRESS (~20 min elapsed)
 *  - Per complete round: 6–10 extensions, 4–6 drops, 2–3 penalties, 3 judge calls
 *  - In-progress round: 3 extensions so far, no drops yet
 *
 * Idempotent: deletes existing test tournament and recreates from scratch.
 *
 * Run: npx ts-node --compiler-options '{"module":"CommonJS"}' src/db/seed-test-tournament.ts
 */
import 'dotenv/config';
import { prisma } from './prisma';

// ─── Config ────────────────────────────────────────────────────────────────────

const TOURNAMENT_NAME = '[TEST] Riftbound Regional RQ 2026';
const SHORT_NAME = 'DEV-RQ-2026';
const GAME_ID = 3; // Riftbound
const ROUND_DURATION_MIN = 60;
const BREAK_MIN = 15;
const TABLE_COUNT = 120; // tables 1–120

// ─── Helper data ───────────────────────────────────────────────────────────────

const PLAYER_NAMES = [
  'Alice Chen', 'Bob Martinez', 'Carol Smith', 'David Kim', 'Elena Reyes',
  'Frank Liu', 'Grace Park', 'Henry Brown', 'Isabel Torres', 'James Wilson',
  'Karen Lee', 'Liam Johnson', 'Mia Patel', 'Noah Clark', 'Olivia White',
  'Paul Davis', 'Quinn Adams', 'Rachel Moore', 'Sam Taylor', 'Tara Jackson',
  'Uma Hernandez', 'Victor Lewis', 'Wendy Walker', 'Xander Hall', 'Yara Allen',
  'Zoe Young', 'Aaron King', 'Beth Wright', 'Carlos Scott', 'Diana Green',
];

const JUDGE_NAMES = [
  'Marcus Webb', 'Sandra Okafor', 'Tom Nakamura', 'Priya Singh', 'Leon Dubois',
  'Fatima Al-Hassan', 'Chris Bergström',
];

const INFRACTIONS = [
  'Slow Play', 'Slow Play', // more common
  'Late to Match',
  'Communication Policy Violation',
  'Marked Cards',
];

const SANCTIONS = ['Warning', 'Warning', 'Warning', 'Game Loss'];

const JUDGE_RESULTS = [
  'Extension granted', 'No infraction', 'Slow play warning issued',
  'Deck check complete', 'Player assistance', 'Results dispute resolved',
];

// ─── Time helpers ──────────────────────────────────────────────────────────────

/** Minutes before now */
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);
/** Minutes after now */
const minsFromNow = (m: number) => new Date(Date.now() + m * 60_000);

function pick<T>(arr: T[]): T {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function tables(n: number): number[] {
  const used = new Set<number>();
  while (used.size < n) used.add(randInt(1, TABLE_COUNT));
  return [...used];
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Seeding test tournament...');

  // --- Wipe existing test tournament(s) ---
  const existing = await prisma.appTournament.findMany({
    where: { isTestTournament: true },
  });
  for (const t of existing) {
    await prisma.appTournament.delete({ where: { id: t.id } });
    console.log(`  Deleted existing test tournament: ${t.name} (id=${t.id})`);
  }

  // --- Verify game exists ---
  const game = await prisma.game.findUnique({ where: { id: GAME_ID } });
  if (!game) throw new Error(`Game id=${GAME_ID} not found. Run the games migration first.`);

  // --- Create tournament ---
  const tourn = await prisma.appTournament.create({
    data: {
      name: TOURNAMENT_NAME,
      shortName: SHORT_NAME,
      gameId: GAME_ID,
      isActive: true,
      isEnded: false,
      isTestTournament: true,
    },
  });
  const tid = tourn.id;
  console.log(`  Created tournament id=${tid}`);

  // --- Source mappings (both enabled with fake IDs) ---
  await prisma.tournamentSourceMapping.createMany({
    data: [
      { tournamentId: tid, source: 'carde',      externalId: '999001', isEnabled: true, metadata: {} },
      { tournamentId: tid, source: 'purplefox',  externalId: 'aaaaaaaa-test-0000-0000-000000000001', isEnabled: true, metadata: {} },
    ],
  });

  // --- Worker state ---
  await prisma.workerState.create({
    data: {
      tournamentId: tid,
      isRunning: false,
      lastRoundsFetchedAt: minsAgo(2),
      lastMatchesFetchedAt: minsAgo(2),
      currentRound: 5,
      lastError: null,
    },
  });

  // ─── Round timing layout ──────────────────────────────────────────────────────
  // R1 starts 5h 15m ago, each subsequent round starts 75m after the previous
  // R5 started 20 min ago (timer has 40 min remaining — comfortable state for testing)
  //
  // Timeline:
  //   R1: -315m → -255m (COMPLETE, snap at -253m)
  //   R2: -240m → -180m (COMPLETE, snap at -178m)
  //   R3: -165m → -105m (COMPLETE, snap at -103m)
  //   R4:  -90m →  -30m (COMPLETE, snap at -28m)
  //   R5:  -20m →  +40m (IN_PROGRESS)

  const roundSchedule = [
    { startMinsAgo: 315, endMinsAgo: 255, snapMinsAgo: 253, outstanding: [14, 67, 88, 102, 115] },
    { startMinsAgo: 240, endMinsAgo: 180, snapMinsAgo: 178, outstanding: [7, 23, 55] },
    { startMinsAgo: 165, endMinsAgo: 105, snapMinsAgo: 103, outstanding: [12, 34, 78, 91, 99, 107] },
    { startMinsAgo:  90, endMinsAgo:  30, snapMinsAgo:  28, outstanding: [5, 44] },
  ];

  const createdRounds: number[] = [];

  // ─── Rounds 1–4 (COMPLETE) ────────────────────────────────────────────────────
  for (let i = 0; i < roundSchedule.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const sched = roundSchedule[i]!;
    const roundNum = i + 1;
    const startedAt = minsAgo(sched.startMinsAgo);
    const timerEnd = minsAgo(sched.endMinsAgo);
    const snappedAt = minsAgo(sched.snapMinsAgo);

    const round = await prisma.round.create({
      data: {
        tournamentId: tid,
        roundNumber: roundNum,
        phase: 'swiss',
        cardeRoundId: 999000 + roundNum,
        cardeStatus: 'COMPLETE',
        startedAt,
        timerDurationMin: ROUND_DURATION_MIN,
        timerEndDatetime: timerEnd,
        completedAt: minsAgo(sched.endMinsAgo - 5), // results all in ~5 min after timer
        missingTablesJson: sched.outstanding,
        snapshotCapturedAt: snappedAt,
      },
    });
    createdRounds.push(round.id);

    // Extensions (6–9 per round)
    const extTables = tables(randInt(6, 9));
    for (const tbl of extTables) {
      const fromMin = randInt(0, 5) * 5; // 0, 5, 10, 15, or 20
      const addedMin = pick([5, 10, 15]);
      const toMin = fromMin + addedMin;
      // Spread extension times throughout the round (first 45 min)
      const extOffset = randInt(5, 50);
      await prisma.extension.create({
        data: {
          tournamentId: tid,
          roundId: round.id,
          round: roundNum,
          tableNumber: tbl,
          fromMinutes: fromMin,
          toMinutes: toMin,
          extensionMinutes: addedMin,
          actionText: `Change time from ${fromMin}min to ${toMin}min`,
          userId: null,
          source: 'purplefox',
          createdAt: new Date(startedAt.getTime() + extOffset * 60_000),
        },
      });
    }

    // Drops (3–6 per round)
    const dropCount = randInt(3, 6);
    const dropPlayers = PLAYER_NAMES.slice(i * 6, i * 6 + dropCount);
    for (const [di, playerName] of dropPlayers.entries()) {
      const droppedTable = randInt(1, TABLE_COUNT);
      const addedBy = pick(JUDGE_NAMES);
      const isChecked = Math.random() > 0.3;
      await prisma.drop.create({
        data: {
          tournamentId: tid,
          playerGameId: `PG-TEST-${tid}-R${roundNum}-${di}`,
          round: roundNum,
          tableNumber: droppedTable,
          playerName,
          isChecked,
          isCancelled: false,
          addedByName: addedBy,
          verifiedByName: isChecked ? pick(JUDGE_NAMES) : null,
        },
      });
    }

    // Penalties (2–3 per round)
    const penCount = randInt(2, 3);
    for (let pi = 0; pi < penCount; pi++) {
      const playerName = pick(PLAYER_NAMES);
      const infraction = pick(INFRACTIONS);
      const sanction = pick(SANCTIONS);
      await prisma.penalty.create({
        data: {
          tournamentId: tid,
          round: roundNum,
          playerGameId: `PG-TEST-P-${tid}-R${roundNum}-${pi}`,
          playerName,
          description: `${infraction} at table ${randInt(1, TABLE_COUNT)}`,
          infraction,
          sanction,
          creatorId: null,
          creatorName: pick(JUDGE_NAMES),
          createdAt: new Date(startedAt.getTime() + randInt(10, 55) * 60_000),
        },
      });
    }

    // Judge calls (2–4 per round)
    const callTables = tables(randInt(2, 4));
    for (const tbl of callTables) {
      const firstSeenAt = new Date(startedAt.getTime() + randInt(5, 55) * 60_000);
      await prisma.tableJudgeCall.create({
        data: {
          tournamentId: tid,
          round: roundNum,
          tableNumber: tbl,
          judge: pick(JUDGE_NAMES),
          judgeResult: pick(JUDGE_RESULTS),
          firstSeenAt,
        },
      });
    }

    console.log(`  Round ${roundNum} (COMPLETE): ${extTables.length} ext, ${dropPlayers.length} drops, ${penCount} penalties`);
  }

  // ─── Round 5 (IN_PROGRESS) ────────────────────────────────────────────────────
  const r5StartedAt = minsAgo(20);
  const r5TimerEnd = minsFromNow(40);

  const r5 = await prisma.round.create({
    data: {
      tournamentId: tid,
      roundNumber: 5,
      phase: 'swiss',
      cardeRoundId: 999005,
      cardeStatus: 'IN_PROGRESS',
      startedAt: r5StartedAt,
      timerDurationMin: ROUND_DURATION_MIN,
      timerEndDatetime: r5TimerEnd,
      completedAt: null,
      snapshotCapturedAt: null,
    },
  });
  createdRounds.push(r5.id);

  // A few extensions already granted in the live round
  const liveExtTables = tables(4);
  for (const tbl of liveExtTables) {
    const fromMin = 0;
    const addedMin = pick([5, 10]);
    await prisma.extension.create({
      data: {
        tournamentId: tid,
        roundId: r5.id,
        round: 5,
        tableNumber: tbl,
        fromMinutes: fromMin,
        toMinutes: fromMin + addedMin,
        extensionMinutes: addedMin,
        actionText: `Change time from ${fromMin}min to ${fromMin + addedMin}min`,
        userId: null,
        source: 'purplefox',
        createdAt: new Date(r5StartedAt.getTime() + randInt(5, 18) * 60_000),
      },
    });
  }

  console.log(`  Round 5 (IN_PROGRESS): ${liveExtTables.length} extensions, timer has ~40 min remaining`);
  console.log(`\n✓ Test tournament "${TOURNAMENT_NAME}" created (id=${tid})`);
  console.log(`  Game: ${game.name} | Rounds: 4 COMPLETE + 1 IN_PROGRESS | Tables: ${TABLE_COUNT}`);
  console.log(`  Reload the app and select "${SHORT_NAME}" to see live data.`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
