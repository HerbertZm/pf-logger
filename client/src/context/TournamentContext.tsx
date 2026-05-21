import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api } from '../api/client';
import type { Tournament } from '../api/types';

interface TournamentState {
  tournaments: Tournament[];
  activeTournamentId: number | null;
  activeTournament: Tournament | null;
  sources: { pf: boolean; carde: boolean };
  setActiveTournament: (id: number) => void;
}

const TournamentContext = createContext<TournamentState | null>(null);

export const TournamentProvider = ({ children }: { children: ReactNode }) => {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [activeTournamentId, setActiveId] = useState<number | null>(() => {
    const stored = localStorage.getItem('active_tournament_id');
    return stored ? Number(stored) : null;
  });

  const fetchTournaments = useCallback((currentId: number | null) => {
    api
      .get<Tournament[]>('/api/tournaments')
      .then((list) => {
        setTournaments(list);
        if (currentId !== null) {
          // Validate the restored ID against the fetched list. If it refers to a tournament that
          // no longer exists (e.g. was soft-deleted), fall through to auto-select below.
          const stillExists = list.some((t) => t.id === currentId);
          if (stillExists) return;
        }
        // No valid stored ID — auto-select the active tournament or the first in the list.
        const active = list.find((t) => t.isActive) ?? list[0] ?? null;
        if (active) setActiveId(active.id);
      })
      .catch(() => {});
  }, []);

  // Initial fetch — fires after mount (token may not be validated yet; api client will
  // dispatch auth:expired if it gets a 401, which clears auth state; auth:login re-fetches)
  useEffect(() => {
    fetchTournaments(activeTournamentId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch on login (token was just established) and clear on logout
  useEffect(() => {
    const onLogin = () => fetchTournaments(null);
    const onLogout = () => setTournaments([]);
    window.addEventListener('auth:login', onLogin);
    window.addEventListener('auth:logout', onLogout);
    return () => {
      window.removeEventListener('auth:login', onLogin);
      window.removeEventListener('auth:logout', onLogout);
    };
  }, [fetchTournaments]);

  const setActiveTournament = (id: number): void => {
    localStorage.setItem('active_tournament_id', String(id));
    setActiveId(id);
  };

  const activeTournament = tournaments.find((t) => t.id === activeTournamentId) ?? null;
  const sources = activeTournament?.sources ?? { pf: false, carde: false };

  return (
    <TournamentContext.Provider
      value={{ tournaments, activeTournamentId, activeTournament, sources, setActiveTournament }}
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
