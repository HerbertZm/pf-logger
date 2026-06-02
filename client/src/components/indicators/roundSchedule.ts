import type { Round } from '../../api/types';

/** Break between Swiss rounds — used to estimate when the next round starts. */
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
    let endAnchor: Date | null = null;

    return sorted.map((round) => {
        const lengthMin = roundLengthMinutes(round, fallback);
        const started = hasStarted(round);

        let start: ScheduleTime | null = null;
        if (round.startedAt !== null) {
            start = { at: new Date(round.startedAt), estimated: false };
        } else if (endAnchor !== null) {
            start = { at: addMinutes(endAnchor, BREAK_BETWEEN_ROUNDS_MIN), estimated: true };
        }

        let end: ScheduleTime | null = null;
        if (round.timerEndDatetime !== null) {
            end = { at: new Date(round.timerEndDatetime), estimated: false };
        } else if (start !== null && lengthMin !== null) {
            end = { at: addMinutes(start.at, lengthMin), estimated: start.estimated };
        }

        let durationMinutes: number | null = null;
        let durationEstimated = false;
        if (start !== null && end !== null) {
            durationMinutes = diffMinutes(start.at, end.at);
            durationEstimated = start.estimated || end.estimated;
        } else if (!started && lengthMin !== null) {
            // Planning slot: round clock + break before the next round
            durationMinutes = lengthMin + BREAK_BETWEEN_ROUNDS_MIN;
            durationEstimated = true;
        }

        if (end !== null) {
            endAnchor = end.at;
        } else if (start !== null && lengthMin !== null) {
            endAnchor = addMinutes(start.at, lengthMin);
        }

        return { round, start, end, durationMinutes, durationEstimated };
    });
}

export function formatScheduleTime(time: ScheduleTime | null): string {
    if (time === null) return '—';
    return time.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(minutes: number | null): string {
    if (minutes === null) return '—';
    return `${minutes}m`;
}
