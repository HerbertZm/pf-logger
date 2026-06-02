/**
 * Canonical API response types — single source of truth for FE↔BE contract.
 *
 * client/src/api/types.ts MUST mirror this file exactly.
 * When adding or changing a field here, update the client file too.
 *
 * Rules:
 *  - All Date fields must be serialized to ISO strings before leaving the backend.
 *  - No Prisma model types may appear in responses — use these interfaces instead.
 *  - Serializer functions in src/routes/serializers.ts enforce these shapes at compile time.
 */

export interface Round {
    id: number;
    tournamentId: number;
    roundNumber: number;
    phase: 'swiss' | 'top8';
    cardeStatus: string | null;
    startedAt: string | null;
    timerDurationMinutes: number | null;
    timerEndDatetime: string | null;
    missingTablesJson: number[] | null;
    snapshotCapturedAt: string | null;
}

export interface Drop {
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

export interface Extension {
    id: number;
    tournamentId: number;
    roundId: number | null;
    round: number | null;
    tableNumber: number;
    fromMinutes: number | null;
    toMinutes: number | null;
    extensionMinutes: number | null;
    userId: string | null;
    createdAt: string;
    source: 'purplefox' | 'carde';
}

export interface Penalty {
    id: number;
    tournamentId: number;
    round: number | null;
    playerGameId: string | null;
    playerName: string | null;
    description: string;
    infraction: string | null;
    sanction: string | null;
    createdAt: string;
    creatorName: string | null;
}

export interface Coverage {
    id: number;
    tournamentId: number;
    round: number | null;
    tableNumber: number;
    coveredBy: string;
    firstSeenAt: string;
}

export interface JudgeCall {
    id: number;
    tournamentId: number;
    round: number;
    tableNumber: number;
    judge: string | null;
    judgeResult: string;
    firstSeenAt: string;
}

export interface Tournament {
    id: number;
    name: string;
    shortName: string;
    isActive: boolean;
    isEnded: boolean;
    sources: { pf: boolean; carde: boolean };
}

export interface WorkerStatus {
    isRunning: boolean;
    lastSync: string | null;
    error: string | null;
    pfJwtExpiresAt: string | null;
}

export type LogEntry =
    | ({ type: 'drop' } & Drop)
    | ({ type: 'extension' } & Extension)
    | ({ type: 'penalty' } & Penalty)
    | ({ type: 'coverage' } & Coverage)
    | ({ type: 'judge_call' } & JudgeCall);

export interface ActiveRoundResponse {
    round: Round;
    outstandingTables: number[];
    tablesWithExtensions: number[];
    extensions: Extension[];
    dropCount: number;
    penaltyCount: number;
    nowUtc: string;
}

export interface LogsResponse {
    rounds: Round[];
    entries: LogEntry[];
}

export interface RoundSummary {
    round: Round;
    dropCount: number;
    extensionCount: number;
    penaltyCount: number;
    outstandingAtTimeCalled: number;
    overtimeMinutes: number | null;
    extensions: Extension[];
}

export interface MeResponse {
    username: string;
    role: string;
}

export interface LoginResponse {
    token: string;
    username: string;
    role: string;
}
