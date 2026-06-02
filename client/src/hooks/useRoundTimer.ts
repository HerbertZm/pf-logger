import { useEffect, useState } from 'react';
import type { Round } from '../api/types';

type Urgency = 'success' | 'warning' | 'urgent';

interface TimerState {
    remaining: number; // seconds; negative = overtime
    isOvertime: boolean;
    isTopEight: boolean;
    urgency: Urgency;
}

const TOP_EIGHT_STATE: TimerState = {
    remaining: 0,
    isOvertime: false,
    isTopEight: true,
    urgency: 'success',
};

export const useRoundTimer = (round: Round | null, outstandingCount: number): TimerState => {
    const [remaining, setRemaining] = useState(0);

    useEffect(() => {
        if (round === null) {
            setRemaining(0);
            return;
        }
        if (round.timerDurationMinutes === null || round.timerEndDatetime === null) {
            setRemaining(0);
            return;
        }
        const endMs = new Date(round.timerEndDatetime).getTime();
        const tick = (): void => setRemaining(Math.floor((endMs - Date.now()) / 1000));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [round?.id, round?.timerEndDatetime]); // eslint-disable-line react-hooks/exhaustive-deps

    if (round === null) return TOP_EIGHT_STATE;
    if (round.timerDurationMinutes === null) return TOP_EIGHT_STATE;

    const isOvertime = remaining <= 0;
    let urgency: Urgency = 'success';
    if (isOvertime || outstandingCount >= 5) urgency = 'urgent';
    else if (remaining <= 300 || outstandingCount >= 1) urgency = 'warning';

    return { remaining, isOvertime, isTopEight: false, urgency };
};
