/** Top-8 rounds have null timer_duration_minutes — use for phase when not already stored. */
export function inferRoundPhase(timerDurationMin: number | null, existingPhase?: string | null): 'swiss' | 'top8' {
    if (existingPhase === 'top8' || existingPhase === 'swiss') {
        return existingPhase;
    }
    return timerDurationMin === null ? 'top8' : 'swiss';
}
