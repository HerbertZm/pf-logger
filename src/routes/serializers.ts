import type { Prisma } from '../generated/prisma/client';
import type { Round, Drop, Extension, Penalty, Coverage, JudgeCall, Game, Tournament } from '../api/types';

// ─── Prisma model shapes (input side) ─────────────────────────────────────────
// These are the minimal fields each serializer needs from the Prisma model.
// Using structural typing so any superset (e.g. full Prisma result) is accepted.

interface PrismaRound {
    id: number;
    tournamentId: number;
    roundNumber: number;
    phase: string;
    cardeStatus: string | null;
    startedAt: Date | null;
    timerDurationMin: number | null;
    timerEndDatetime: Date | null;
    missingTablesJson: Prisma.JsonValue;
    snapshotCapturedAt: Date | null;
}

interface PrismaDrop {
    id: number;
    tournamentId: number;
    playerGameId: string;
    round: number;
    tableNumber: number | null;
    playerName: string | null;
    isChecked: boolean;
    isCancelled: boolean;
    addedByName: string | null;
    verifiedByName: string | null;
}

interface PrismaExtension {
    id: number;
    tournamentId: number;
    roundId: number | null;
    round: number | null;
    tableNumber: number;
    fromMinutes: number | null;
    toMinutes: number | null;
    extensionMinutes: number | null;
    userId: string | null;
    createdAt: Date;
    source: string;
}

interface PrismaPenalty {
    id: number;
    tournamentId: number;
    round: number | null;
    playerGameId: string | null;
    playerName: string | null;
    description: string;
    infraction: string | null;
    sanction: string | null;
    createdAt: Date;
    creatorName: string | null;
}

interface PrismaCoverage {
    id: number;
    tournamentId: number;
    round: number | null;
    tableNumber: number;
    coveredBy: string;
    firstSeenAt: Date;
}

interface PrismaJudgeCall {
    id: number;
    tournamentId: number;
    round: number;
    tableNumber: number;
    judge: string | null;
    judgeResult: string;
    firstSeenAt: Date;
}

interface PrismaGame {
    id: number;
    name: string;
    defaultRoundLengthMin: number;
    notes: Prisma.JsonValue;
}

interface PrismaSourceMapping {
    source: string;
    isEnabled: boolean;
}

interface PrismaTournamentWithGame {
    id: number;
    name: string;
    shortName: string;
    gameId: number;
    isActive: boolean;
    isEnded: boolean;
    game: PrismaGame;
    sourceMappings: PrismaSourceMapping[];
}

// ─── Serializers ───────────────────────────────────────────────────────────────

export function serializeGame(g: PrismaGame): Game {
    return {
        id: g.id,
        name: g.name,
        defaultRoundLengthMinutes: g.defaultRoundLengthMin,
        notes: g.notes === null || g.notes === undefined ? null : (g.notes as Record<string, unknown>),
    };
}

export function serializeTournament(t: PrismaTournamentWithGame): Tournament {
    return {
        id: t.id,
        name: t.name,
        shortName: t.shortName,
        gameId: t.gameId,
        game: serializeGame(t.game),
        isActive: t.isActive,
        isEnded: t.isEnded,
        sources: {
            pf: t.sourceMappings.some((m) => m.source === 'purplefox' && m.isEnabled),
            carde: t.sourceMappings.some((m) => m.source === 'carde' && m.isEnabled),
        },
    };
}

export function serializeRound(r: PrismaRound): Round {
    return {
        id: r.id,
        tournamentId: r.tournamentId,
        roundNumber: r.roundNumber,
        phase: r.phase as 'swiss' | 'top8',
        cardeStatus: r.cardeStatus,
        startedAt: r.startedAt?.toISOString() ?? null,
        timerDurationMinutes: r.timerDurationMin,
        timerEndDatetime: r.timerEndDatetime?.toISOString() ?? null,
        missingTablesJson: r.missingTablesJson as number[] | null,
        snapshotCapturedAt: r.snapshotCapturedAt?.toISOString() ?? null,
    };
}

export function serializeDrop(d: PrismaDrop): Drop {
    return {
        id: d.id,
        tournamentId: d.tournamentId,
        playerGameId: d.playerGameId,
        round: d.round,
        tableNumber: d.tableNumber,
        playerName: d.playerName,
        isChecked: d.isChecked,
        isCancelled: d.isCancelled,
        addedByName: d.addedByName,
        verifiedByName: d.verifiedByName,
    };
}

export function serializeExtension(e: PrismaExtension): Extension {
    return {
        id: e.id,
        tournamentId: e.tournamentId,
        roundId: e.roundId,
        round: e.round,
        tableNumber: e.tableNumber,
        fromMinutes: e.fromMinutes,
        toMinutes: e.toMinutes,
        extensionMinutes: e.extensionMinutes,
        userId: e.userId,
        staffName: null, // resolved at query time in /api/logs via pf_staff lookup
        createdAt: e.createdAt.toISOString(),
        source: e.source as 'purplefox' | 'carde',
    };
}

export function serializePenalty(p: PrismaPenalty): Penalty {
    return {
        id: p.id,
        tournamentId: p.tournamentId,
        round: p.round,
        playerGameId: p.playerGameId,
        playerName: p.playerName,
        description: p.description,
        infraction: p.infraction,
        sanction: p.sanction,
        createdAt: p.createdAt.toISOString(),
        creatorName: p.creatorName,
    };
}

export function serializeCoverage(c: PrismaCoverage): Coverage {
    return {
        id: c.id,
        tournamentId: c.tournamentId,
        round: c.round,
        tableNumber: c.tableNumber,
        coveredBy: c.coveredBy,
        firstSeenAt: c.firstSeenAt.toISOString(),
    };
}

export function serializeJudgeCall(j: PrismaJudgeCall): JudgeCall {
    return {
        id: j.id,
        tournamentId: j.tournamentId,
        round: j.round,
        tableNumber: j.tableNumber,
        judge: j.judge,
        judgeResult: j.judgeResult,
        firstSeenAt: j.firstSeenAt.toISOString(),
    };
}
