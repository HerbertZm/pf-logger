import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api } from '../api/client';
import type { Tournament } from '../api/types';

const HIDE_TEST_KEY = 'hide_test_tournaments';

export function sortTournaments(list: Tournament[]): Tournament[] {
    return [...list].sort((a, b) => {
        if (a.isEnded !== b.isEnded) return a.isEnded ? 1 : -1;
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

function applyTestFilter(list: Tournament[]): Tournament[] {
    if (localStorage.getItem(HIDE_TEST_KEY) !== 'true') return list;
    return list.filter((t) => !t.isTestTournament);
}

interface TournamentState {
    tournaments: Tournament[];
    activeTournamentId: number | null;
    activeTournament: Tournament | null;
    sources: { pf: boolean; carde: boolean };
    setActiveTournament: (id: number) => void;
    refreshTournaments: () => void;
    hideTestTournaments: boolean;
    setHideTestTournaments: (hide: boolean) => void;
}

const TournamentContext = createContext<TournamentState | null>(null);

export const TournamentProvider = ({ children }: { children: ReactNode }) => {
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [hideTestTournaments, setHideTestState] = useState(
        () => localStorage.getItem(HIDE_TEST_KEY) === 'true',
    );
    const [activeTournamentId, setActiveId] = useState<number | null>(() => {
        const stored = localStorage.getItem('active_tournament_id');
        return stored ? Number(stored) : null;
    });

    const fetchTournaments = useCallback((currentId: number | null) => {
        api.get<Tournament[]>('/api/tournaments')
            .then((list) => {
                const sorted = sortTournaments(applyTestFilter(list));
                setTournaments(sorted);
                if (currentId !== null) {
                    const stillExists = sorted.some((t) => t.id === currentId);
                    if (stillExists) return;
                }
                const active = sorted.find((t) => t.isActive && !t.isEnded) ?? sorted[0] ?? null;
                if (active) setActiveId(active.id);
            })
            .catch(() => {});
    }, []);

    const refreshTournaments = useCallback(() => {
        fetchTournaments(activeTournamentId);
    }, [fetchTournaments, activeTournamentId]);

    const setHideTestTournaments = useCallback(
        (hide: boolean) => {
            localStorage.setItem(HIDE_TEST_KEY, hide ? 'true' : 'false');
            setHideTestState(hide);
            fetchTournaments(activeTournamentId);
        },
        [fetchTournaments, activeTournamentId],
    );

    useEffect(() => {
        fetchTournaments(activeTournamentId);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const onLogin = () => fetchTournaments(null);
        const onLogout = () => setTournaments([]);
        const onRefresh = () => refreshTournaments();
        window.addEventListener('auth:login', onLogin);
        window.addEventListener('auth:logout', onLogout);
        window.addEventListener('tournaments:refresh', onRefresh);
        return () => {
            window.removeEventListener('auth:login', onLogin);
            window.removeEventListener('auth:logout', onLogout);
            window.removeEventListener('tournaments:refresh', onRefresh);
        };
    }, [fetchTournaments, refreshTournaments]);

    const setActiveTournament = (id: number): void => {
        localStorage.setItem('active_tournament_id', String(id));
        setActiveId(id);
    };

    const activeTournament = tournaments.find((t) => t.id === activeTournamentId) ?? null;
    const sources = activeTournament?.sources ?? { pf: false, carde: false };

    return (
        <TournamentContext.Provider
            value={{
                tournaments,
                activeTournamentId,
                activeTournament,
                sources,
                setActiveTournament,
                refreshTournaments,
                hideTestTournaments,
                setHideTestTournaments,
            }}
        >
            {children}
        </TournamentContext.Provider>
    );
};

export const useTournament = (): TournamentState => {
    const ctx = useContext(TournamentContext);
    if (!ctx) throw new Error('useTournament must be used within TournamentProvider');
    return ctx;
};
