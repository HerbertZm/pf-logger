import { useEffect, useRef, useState } from 'react';
import './LogFeed.css';
import { api } from '../../api/client';
import type { LogsResponse, LogEntry } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';
import { Banner } from '../shared/Banner';
import { FilterBar, type FilterState, type LogType } from './FilterBar';
import { RoundGroup } from './RoundGroup';

const POLL_MS = 20_000;
const STORAGE_KEY = 'logs-filter';

const loadFilter = (): FilterState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { types: new Set(), search: '' };
    const parsed = JSON.parse(raw) as { types: LogType[]; search: string };
    return { types: new Set(parsed.types), search: parsed.search };
  } catch {
    return { types: new Set(), search: '' };
  }
};

const saveFilter = (f: FilterState) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ types: [...f.types], search: f.search }));
};

export const LogFeed = () => {
  const { activeTournamentId } = useTournament();
  const [data, setData] = useState<LogsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>(loadFilter);
  const lastViewedRef = useRef(Date.now());

  useEffect(() => {
    lastViewedRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (!activeTournamentId) return;
    const fetch = () =>
      api
        .get<LogsResponse>(`/api/logs?tournamentId=${activeTournamentId}`)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    fetch();
    const id = setInterval(fetch, POLL_MS);
    return () => clearInterval(id);
  }, [activeTournamentId]);

  const handleFilterChange = (f: FilterState) => {
    setFilter(f);
    saveFilter(f);
  };

  if (error) return <Banner variant="error" message={error} />;

  const applyFilter = (entries: LogEntry[]): LogEntry[] => {
    let out = entries;
    if (filter.types.size > 0) out = out.filter((e) => filter.types.has(e.type as LogType));
    if (filter.search) {
      const q = filter.search.toLowerCase();
      out = out.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
    }
    return out;
  };

  const rounds = data?.rounds ?? [];
  const allEntries = data?.entries ?? [];

  return (
    <div className="log-feed">
      <FilterBar filter={filter} onChange={handleFilterChange} />

      {rounds.length === 0 && (
        <p className="log-feed__empty">No data yet — waiting for first sync.</p>
      )}

      {rounds.map((round) => {
        const entries = applyFilter(
          allEntries.filter((e) => {
            const r = 'round' in e ? e.round : null;
            return r === round.roundNumber;
          }),
        );
        return <RoundGroup key={round.id} round={round} entries={entries} />;
      })}
    </div>
  );
};
