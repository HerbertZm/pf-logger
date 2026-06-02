import type { RawPfDrop } from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import { logger } from '../lib/logger';
import { inferRoundPhase } from '../utils/roundPhase';
import { computeTimerEnd } from './worker';

export interface BackfillResult {
    rounds: number;
    matches: number;
    drops: number;
    extensions: number;
    penalties: number;
    judgeCalls: number;
    coverage: number;
}

function dropStaffNameFromRaw(row: RawPfDrop): string | null {
    if (row.rawPayload === null || typeof row.rawPayload !== 'object') {
        return null;
    }
    const name = (row.rawPayload as Record<string, unknown>)['updated_by_name'];
    return typeof name === 'string' ? name : null;
}

/** Re-derive normalized tables from the latest raw rows per entity (no API calls). */
export async function backfillTournamentFromRaw(tournamentId: number): Promise<BackfillResult> {
    const result: BackfillResult = {
        rounds: 0,
        matches: 0,
        drops: 0,
        extensions: 0,
        penalties: 0,
        judgeCalls: 0,
        coverage: 0,
    };

    const pfEnabled = await prisma.tournamentSourceMapping.findFirst({
        where: { tournamentId, source: 'purplefox', isEnabled: true },
    });

    // ── Carde rounds (latest per carde_round_id) ──
    const roundRaws = await prisma.rawCardeRound.findMany({
        where: { tournamentId },
        orderBy: { fetchedAt: 'desc' },
    });
    const latestRounds = new Map<number, (typeof roundRaws)[number]>();
    for (const row of roundRaws) {
        if (!latestRounds.has(row.cardeRoundId)) {
            latestRounds.set(row.cardeRoundId, row);
        }
    }

    for (const r of latestRounds.values()) {
        const startedAt = r.startedAt;
        const timerEnd =
            startedAt !== null && r.timerDurationMin !== null
                ? computeTimerEnd(startedAt, r.timerDurationMin)
                : null;

        const existing = await prisma.round.findUnique({
            where: { tournamentId_roundNumber: { tournamentId, roundNumber: r.roundNumber } },
        });

        const phase = inferRoundPhase(r.timerDurationMin, existing?.phase);

        await prisma.round.upsert({
            where: { tournamentId_roundNumber: { tournamentId, roundNumber: r.roundNumber } },
            create: {
                tournamentId,
                roundNumber: r.roundNumber,
                phase,
                cardeRoundId: r.cardeRoundId,
                cardeStatus: r.cardeStatus,
                startedAt,
                timerDurationMin: r.timerDurationMin,
                timerEndDatetime: timerEnd,
                completedAt: r.completedAt,
            },
            update: {
                cardeStatus: r.cardeStatus,
                startedAt: existing?.startedAt ?? startedAt,
                completedAt: existing?.completedAt ?? r.completedAt,
                timerDurationMin: r.timerDurationMin ?? existing?.timerDurationMin ?? null,
                timerEndDatetime: timerEnd ?? existing?.timerEndDatetime ?? null,
            },
        });
        result.rounds++;
    }

    // ── Carde matches (latest per carde_match_id) ──
    const matchRaws = await prisma.rawCardeMatch.findMany({
        where: { tournamentId },
        orderBy: { fetchedAt: 'desc' },
    });
    const latestMatches = new Map<number, (typeof matchRaws)[number]>();
    for (const row of matchRaws) {
        if (!latestMatches.has(row.cardeMatchId)) {
            latestMatches.set(row.cardeMatchId, row);
        }
    }

    for (const m of latestMatches.values()) {
        if (m.tableNumber === -1) continue;
        const round = await prisma.round.findFirst({
            where: { tournamentId, roundNumber: m.roundNumber },
        });
        if (round === null) continue;

        const resultAt = m.resultReportedAt ?? m.updatedAt;
        const timeExtensionSec = pfEnabled ? 0 : m.timeExtensionSec;

        await prisma.match.upsert({
            where: {
                tournamentId_roundNumber_tableNumber: {
                    tournamentId,
                    roundNumber: m.roundNumber,
                    tableNumber: m.tableNumber,
                },
            },
            create: {
                tournamentId,
                roundId: round.id,
                roundNumber: m.roundNumber,
                tableNumber: m.tableNumber,
                cardeMatchId: m.cardeMatchId,
                status: m.status,
                timeExtensionSec,
                isGhostMatch: m.isGhostMatch,
                isBye: m.isBye,
                matchIsLoss: m.matchIsLoss,
                matchIsIntentionalDraw: m.matchIsIntentionalDraw,
                matchIsUnintentionalDraw: m.matchIsUnintentionalDraw,
                deckCheckStarted: m.deckCheckStarted,
                deckCheckCompleted: m.deckCheckCompleted,
                assignedJudge: m.assignedJudge,
                resultReportedAt: m.resultReportedAt,
                resultAt,
                p1UserId: m.p1UserId,
                p1Name: m.p1Name,
                p2UserId: m.p2UserId,
                p2Name: m.p2Name,
                winningPlayerId: m.winningPlayerId,
            },
            update: {
                status: m.status,
                timeExtensionSec,
                isGhostMatch: m.isGhostMatch,
                matchIsIntentionalDraw: m.matchIsIntentionalDraw,
                matchIsUnintentionalDraw: m.matchIsUnintentionalDraw,
                deckCheckStarted: m.deckCheckStarted,
                deckCheckCompleted: m.deckCheckCompleted,
                assignedJudge: m.assignedJudge,
                resultReportedAt: m.resultReportedAt,
                resultAt,
                winningPlayerId: m.winningPlayerId,
            },
        });
        result.matches++;
    }

    // ── PF drops (latest per player+round) — mirrors normalizeDrops in worker.ts ──
    const dropRaws = await prisma.rawPfDrop.findMany({
        where: { tournamentId },
        orderBy: { fetchedAt: 'desc' },
    });
    const latestDrops = new Map<string, (typeof dropRaws)[number]>();
    for (const row of dropRaws) {
        if (row.round === null) continue;
        const key = `${row.playerGameId}:${row.round}`;
        if (!latestDrops.has(key)) latestDrops.set(key, row);
    }

    for (const d of latestDrops.values()) {
        if (d.round === null) continue;
        const existing = await prisma.drop.findUnique({
            where: {
                tournamentId_playerGameId_round: {
                    tournamentId,
                    playerGameId: d.playerGameId,
                    round: d.round,
                },
            },
        });

        const staffName = dropStaffNameFromRaw(d);

        await prisma.drop.upsert({
            where: {
                tournamentId_playerGameId_round: {
                    tournamentId,
                    playerGameId: d.playerGameId,
                    round: d.round,
                },
            },
            create: {
                tournamentId,
                playerGameId: d.playerGameId,
                round: d.round,
                tableNumber: d.tableNumber,
                playerName: d.playerName,
                isChecked: d.isChecked,
                isCancelled: d.isCancelled,
                addedByName: staffName,
                updatedBy: d.updatedBy,
                source: 'purplefox',
            },
            update: {
                tableNumber: d.tableNumber,
                playerName: d.playerName,
                isChecked: d.isChecked,
                isCancelled: d.isCancelled,
                updatedBy: d.updatedBy ?? null,
                addedByName: existing?.addedByName ?? staffName ?? null,
                verifiedByName:
                    !existing?.isChecked && d.isChecked
                        ? (staffName ?? null)
                        : (existing?.verifiedByName ?? null),
            },
        });
        result.drops++;
    }

    // ── PF extensions (latest per pf_id) ──
    const extRaws = await prisma.rawPfExtension.findMany({
        where: { tournamentId },
        orderBy: { fetchedAt: 'desc' },
    });
    const latestExt = new Map<number, (typeof extRaws)[number]>();
    for (const row of extRaws) {
        if (!latestExt.has(row.pfId)) latestExt.set(row.pfId, row);
    }

    for (const e of latestExt.values()) {
        const pfIdStr = String(e.pfId);
        const round =
            e.round !== null ? await prisma.round.findFirst({ where: { tournamentId, roundNumber: e.round } }) : null;
        const extensionMinutes =
            e.fromMinutes !== null && e.toMinutes !== null ? e.toMinutes - e.fromMinutes : null;

        await prisma.extension.upsert({
            where: { pfId_tournamentId: { pfId: pfIdStr, tournamentId } },
            create: {
                tournamentId,
                roundId: round?.id ?? null,
                round: e.round,
                tableNumber: e.tableNumber,
                fromMinutes: e.fromMinutes,
                toMinutes: e.toMinutes,
                extensionMinutes,
                actionText: e.action,
                userId: e.userId,
                createdAt: e.createdAt,
                source: 'purplefox',
            },
            update: {
                ...(round !== null && { roundId: round.id }),
            },
        });
        result.extensions++;
    }

    // ── PF penalties ──
    const penRaws = await prisma.rawPfPenalty.findMany({
        where: { tournamentId },
        orderBy: { fetchedAt: 'desc' },
    });
    const latestPen = new Map<string, (typeof penRaws)[number]>();
    for (const row of penRaws) {
        if (!latestPen.has(row.pfId)) latestPen.set(row.pfId, row);
    }

    for (const p of latestPen.values()) {
        await prisma.penalty.upsert({
            where: { pfId_tournamentId: { pfId: p.pfId, tournamentId } },
            create: {
                tournamentId,
                pfId: p.pfId,
                round: p.round,
                playerGameId: p.playerGameId,
                playerName: p.playerName,
                description: p.description ?? '',
                infraction: p.infraction,
                sanction: p.sanction,
                createdAt: p.createdAt ?? new Date(),
                creatorId: p.creatorId,
                creatorName: p.creatorName,
                source: 'purplefox',
            },
            update: {},
        });
        result.penalties++;
    }

    // ── PF coverage (current-round snapshot only in PF; round left null) ──
    const covRaws = await prisma.rawPfCoverage.findMany({
        where: { tournamentId },
        orderBy: { fetchedAt: 'desc' },
    });
    const latestCov = new Map<string, (typeof covRaws)[number]>();
    for (const row of covRaws) {
        const key = `${row.tableNumber}:${row.coveredBy}`;
        if (!latestCov.has(key)) latestCov.set(key, row);
    }

    for (const c of latestCov.values()) {
        await prisma.tableCoverage.upsert({
            where: {
                tournamentId_tableNumber_coveredBy: {
                    tournamentId,
                    tableNumber: c.tableNumber,
                    coveredBy: c.coveredBy,
                },
            },
            create: {
                tournamentId,
                round: null,
                tableNumber: c.tableNumber,
                coveredBy: c.coveredBy,
                firstSeenAt: c.firstSeenAt,
            },
            update: {},
        });
        result.coverage++;
    }

    // ── PF judge calls — insert missing from latest raw per (table, round, result) ──
    const jcRaws = await prisma.rawPfJudgeCall.findMany({
        where: { tournamentId },
        orderBy: { fetchedAt: 'desc' },
    });
    const latestJc = new Map<string, (typeof jcRaws)[number]>();
    for (const row of jcRaws) {
        if (row.round === null) continue;
        const key = `${row.tableNumber}:${row.round}:${row.judgeResult}`;
        if (!latestJc.has(key)) latestJc.set(key, row);
    }

    for (const jc of latestJc.values()) {
        if (jc.round === null) continue;
        const existing = await prisma.tableJudgeCall.findFirst({
            where: {
                tournamentId,
                tableNumber: jc.tableNumber,
                round: jc.round,
                judgeResult: jc.judgeResult,
            },
        });
        if (existing !== null) continue;

        await prisma.tableJudgeCall.create({
            data: {
                tournamentId,
                round: jc.round,
                tableNumber: jc.tableNumber,
                judge: jc.judge,
                judgeResult: jc.judgeResult,
                firstSeenAt: jc.firstSeenAt,
            },
        });
        result.judgeCalls++;
    }

    logger.info(`backfill tournament ${tournamentId}`, result);
    return result;
}
