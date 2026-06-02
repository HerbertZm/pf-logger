import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTournament } from './TournamentContext';

interface DashboardRoundState {
    /** null = follow live (current in-progress round) */
    selectedRoundNumber: number | null;
    setSelectedRoundNumber: (roundNumber: number | null) => void;
}

const DashboardRoundContext = createContext<DashboardRoundState | null>(null);

export const DashboardRoundProvider = ({ children }: { children: ReactNode }) => {
    const { activeTournamentId } = useTournament();
    const [selectedRoundNumber, setSelectedRoundNumber] = useState<number | null>(null);

    useEffect(() => {
        setSelectedRoundNumber(null);
    }, [activeTournamentId]);

    return (
        <DashboardRoundContext.Provider value={{ selectedRoundNumber, setSelectedRoundNumber }}>
            {children}
        </DashboardRoundContext.Provider>
    );
};

/** Present only on the dashboard tab (inside `DashboardRoundProvider`). */
export const useDashboardRound = (): DashboardRoundState | null => useContext(DashboardRoundContext);

export const useDashboardRoundRequired = (): DashboardRoundState => {
    const ctx = useContext(DashboardRoundContext);
    if (ctx === null) {
        throw new Error('useDashboardRoundRequired must be used within DashboardRoundProvider');
    }
    return ctx;
};
