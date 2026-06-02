import { useEffect, useState } from 'react';
import type { Round } from '../api/types';
import { getRoundPace, type RoundPaceInfo } from '../utils/roundPace';

export function useRoundPace(round: Round | null): RoundPaceInfo | null {
    const [pace, setPace] = useState<RoundPaceInfo | null>(() => (round !== null ? getRoundPace(round) : null));

    useEffect(() => {
        if (round === null) {
            setPace(null);
            return;
        }
        const tick = (): void => setPace(getRoundPace(round));
        tick();
        const id = setInterval(tick, 30_000);
        return () => clearInterval(id);
    }, [round]);

    return pace;
}
