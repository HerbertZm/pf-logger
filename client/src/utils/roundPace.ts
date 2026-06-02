import type { Round } from '../api/types';

export type RoundPaceLevel = 'on_track' | 'over' | 'significantly_over';

export interface RoundPaceInfo {
    level: RoundPaceLevel;
    overMinutes: number;
    label: string;
}

const COMPLETED_STATUSES = new Set(['COMPLETE', 'COMPLETED', 'complete', 'completed']);

/** Pace vs timer_end_datetime. Null for Top-8, completed rounds, or missing timer. */
export function getRoundPace(round: Round, nowMs: number = Date.now()): RoundPaceInfo | null {
    if (round.timerEndDatetime === null || round.timerDurationMinutes === null) return null;
    if (round.cardeStatus !== null && COMPLETED_STATUSES.has(round.cardeStatus)) return null;

    const endMs = new Date(round.timerEndDatetime).getTime();
    const overMs = nowMs - endMs;
    if (overMs <= 0) {
        return { level: 'on_track', overMinutes: 0, label: 'On track' };
    }

    const overMinutes = Math.ceil(overMs / 60_000);
    if (overMinutes > 15) {
        return { level: 'significantly_over', overMinutes, label: `${overMinutes}m over` };
    }
    return { level: 'over', overMinutes, label: `${overMinutes}m over` };
}
