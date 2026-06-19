import type { Round } from '../../api/types';
import { formatInTournamentTz } from '../../utils/time';

/** Buffer added to estimated round ends — accounts for overtime + cleanup before next round starts. */
export const BREAK_BETWEEN_ROUNDS_MIN = 15;

export interface ScheduleTime {
    at: Date;
    estimated: boolean;
}

export interface RoundScheduleRow {
    round: Round;
    start: ScheduleTime | null;
    end: ScheduleTime | null;
    durationMinutes: number | null;
    durationEstimated: boolean;
}

export function defaultRoundLengthMinutes(rounds: Round[], gameDefaultMinutes?: number): number {
    if (gameDefaultMinutes !== undefined) return gameDefaultMinutes;
    const swiss = rounds.find((r) => r.phase === 'swiss' && r.timerDurationMinutes !== null);
    return swiss?.timerDurationMinutes ?? 50;
}

function roundLengthMinutes(round: Round, fallback: number): number | null {
    if (round.timerDurationMinutes === null) {
        if (round.phase === 'top8') return null;
        return fallback;
    }
    return round.timerDurationMinutes;
}

function addMinutes(d: Date, minutes: number): Date {
    return new Date(d.getTime() + minutes * 60 * 1000);
}

function diffMinutes(start: Date, end: Date): number {
    return Math.round((end.getTime() - start.getTime()) / 60_000);
}

function hasStarted(round: Round): boolean {
    return round.startedAt !== null || round.cardeStatus === 'IN_PROGRESS' || round.cardeStatus === 'COMPLETE';
}

export function buildRoundSchedule(rounds: Round[], gameDefaultMinutes?: number): RoundScheduleRow[] {
    const sorted = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);
    const fallback = defaultRoundLengthMinutes(sorted, gameDefaultMinutes);
    // nextRoundStart is the base for the next round's estimated start time.
    // For real timer ends: nextRoundStart = timerEnd + BREAK (break hasn't happened yet).
    // For estimated ends: the break is already baked into the estimate, so nextRoundStart = estimated end.
    let nextRoundStart: Date | null = null;

    return sorted.map((round) => {
        const lengthMin = roundLengthMinutes(round, fallback);
        const started = hasStarted(round);

        let start: ScheduleTime | null = null;
        if (round.startedAt !== null) {
            start = { at: new Date(round.startedAt), estimated: false };
        } else if (nextRoundStart !== null) {
            start = { at: nextRoundStart, estimated: true };
        }

        let end: ScheduleTime | null = null;
        if (round.lastMatchCompletedAt !== null) {
            // Real end: last match result came in
            end = { at: new Date(round.lastMatchCompletedAt), estimated: false };
            nextRoundStart = end.at; // next round can start right at real end
        } else if (round.timerEndDatetime !== null) {
            // Scheduled clock-0; still need break for next round
            end = { at: new Date(round.timerEndDatetime), estimated: false };
            nextRoundStart = addMinutes(end.at, BREAK_BETWEEN_ROUNDS_MIN);
        } else if (start !== null && lengthMin !== null) {
            // Estimated: round clock + buffer already baked in so next round starts at this end
            end = { at: addMinutes(start.at, lengthMin + BREAK_BETWEEN_ROUNDS_MIN), estimated: true };
            nextRoundStart = end.at;
        } else {
            nextRoundStart = null;
        }

        let durationMinutes: number | null = null;
        let durationEstimated = false;
        if (start !== null && end !== null) {
            durationMinutes = diffMinutes(start.at, end.at);
            durationEstimated = start.estimated || end.estimated;
        } else if (!started && lengthMin !== null) {
            // Upcoming with no anchor: planning slot (clock + break buffer)
            durationMinutes = lengthMin + BREAK_BETWEEN_ROUNDS_MIN;
            durationEstimated = true;
        }

        return { round, start, end, durationMinutes, durationEstimated };
    });
}

export function formatScheduleTime(time: ScheduleTime | null, timeZone: string): string {
    if (time === null) return '—';
    return formatInTournamentTz(time.at.toISOString(), timeZone);
}

export function formatDuration(minutes: number | null): string {
    if (minutes === null) return '—';
    return `${minutes}m`;
}
