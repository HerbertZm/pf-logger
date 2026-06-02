import { useEffect, useRef, useState, type Ref } from 'react';
import './LogFeed.css';
import { api } from '../../api/client';
import type { LogsResponse, LogEntry } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';
import { logEntryKey } from '../../utils/logEntryTime';
import { Banner } from '../shared/Banner';
import { FilterBar, type FilterBarHandle, type FilterPreset, type FilterState, type LogType } from './FilterBar';
import { LogsDiffBanner } from './LogsDiffBanner';
import { RoundGroup } from './RoundGroup';

const DEFAULT_POLL_MS = 20_000;
const POLL_OPTIONS = [15_000, 20_000, 30_000, 60_000] as const;

const filterStorageKey = (tournamentId: number) => `logs-filter-${tournamentId}`;
const pollStorageKey = 'logs-poll-ms';
const expandedRoundStorageKey = (tournamentId: number) => `logs-expanded-round-${tournamentId}`;

const loadExpandedRound = (tournamentId: number | null, latestRoundNumber: number | null): number | null => {
    if (tournamentId === null) return latestRoundNumber;
    const stored = localStorage.getItem(expandedRoundStorageKey(tournamentId));
    if (stored === null) return latestRoundNumber;
    const n = Number(stored);
    return Number.isFinite(n) ? n : latestRoundNumber;
};

const loadFilter = (tournamentId: number | null): FilterState => {
    if (tournamentId === null) return { types: new Set(), search: '', roundNumber: null };
    try {
        const raw = localStorage.getItem(filterStorageKey(tournamentId));
        if (!raw) return { types: new Set(), search: '', roundNumber: null };
        const parsed = JSON.parse(raw) as { types: LogType[]; search: string; roundNumber?: number | null };
        return {
            types: new Set(parsed.types),
            search: parsed.search,
            roundNumber: parsed.roundNumber ?? null,
        };
    } catch {
        return { types: new Set(), search: '', roundNumber: null };
    }
};

const saveFilter = (tournamentId: number, f: FilterState) => {
    localStorage.setItem(
        filterStorageKey(tournamentId),
        JSON.stringify({ types: [...f.types], search: f.search, roundNumber: f.roundNumber }),
    );
};

const loadPollMs = (): number => {
    const stored = Number(localStorage.getItem(pollStorageKey));
    return POLL_OPTIONS.includes(stored as (typeof POLL_OPTIONS)[number]) ? stored : DEFAULT_POLL_MS;
};

interface LogFeedProps {
    filterBarRef?: Ref<FilterBarHandle>;
    isTabActive: boolean;
}

export const LogFeed = ({ filterBarRef, isTabActive }: LogFeedProps) => {
    const { activeTournamentId, activeTournament } = useTournament();
    const tz = activeTournament?.timezone ?? 'America/New_York';
    const [data, setData] = useState<LogsResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterState>(() => loadFilter(activeTournamentId));
    const [activePreset, setActivePreset] = useState<FilterPreset | null>(null);
    const [pollMs, setPollMs] = useState(loadPollMs);
    const [expandedRoundNumber, setExpandedRoundNumber] = useState<number | null>(null);
    const seenEntryKeysRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        setFilter(loadFilter(activeTournamentId));
        setActivePreset(null);
        seenEntryKeysRef.current = new Set();
        setExpandedRoundNumber(null);
    }, [activeTournamentId]);

    useEffect(() => {
        if (activeTournamentId === null || data === null) return;
        const rounds = [...data.rounds].sort((a, b) => b.roundNumber - a.roundNumber);
        const latest = rounds.length > 0 ? rounds[0].roundNumber : null;
        setExpandedRoundNumber((prev) => {
            if (prev !== null && rounds.some((r) => r.roundNumber === prev)) {
                return prev;
            }
            return loadExpandedRound(activeTournamentId, latest);
        });
    }, [activeTournamentId, data]);

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
        void fetch();
        const id = setInterval(() => {
            void fetch();
        }, pollMs);
        return () => clearInterval(id);
    }, [activeTournamentId, pollMs]);

    useEffect(() => {
        if (!isTabActive || !data) return;
        for (const e of data.entries) {
            seenEntryKeysRef.current.add(logEntryKey(e));
        }
    }, [isTabActive, data]);

    const handleFilterChange = (f: FilterState) => {
        setFilter(f);
        if (activeTournamentId !== null) saveFilter(activeTournamentId, f);
    };

    const handlePollChange = (ms: number): void => {
        setPollMs(ms);
        localStorage.setItem(pollStorageKey, String(ms));
    };

    if (error) return <Banner variant="error" message={error} />;

    const applyFilter = (entries: LogEntry[]): LogEntry[] => {
        let out = entries;
        if (filter.roundNumber !== null) {
            out = out.filter((e) => ('round' in e ? e.round : null) === filter.roundNumber);
        }
        if (filter.types.size > 0) out = out.filter((e) => filter.types.has(e.type));
        if (filter.search) {
            const q = filter.search.toLowerCase();
            out = out.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
        }
        return out;
    };

    const rounds = (data?.rounds ?? []).sort((a, b) => b.roundNumber - a.roundNumber);
    const allEntries = data?.entries ?? [];
    const latestRoundNumber = rounds.length > 0 ? rounds[0].roundNumber : null;

    const handleRoundExpand = (roundNumber: number, collapsed: boolean): void => {
        if (collapsed || activeTournamentId === null) return;
        setExpandedRoundNumber(roundNumber);
        localStorage.setItem(expandedRoundStorageKey(activeTournamentId), String(roundNumber));
    };

    const isEntryNew = (e: LogEntry): boolean => {
        if (isTabActive) return false;
        return !seenEntryKeysRef.current.has(logEntryKey(e));
    };

    return (
        <div className="log-feed">
            <div className="log-feed__toolbar">
                <label className="log-feed__poll">
                    Refresh
                    <select
                        value={pollMs}
                        onChange={(e) => handlePollChange(Number(e.target.value))}
                        aria-label="Log refresh interval"
                    >
                        {POLL_OPTIONS.map((ms) => (
                            <option key={ms} value={ms}>
                                {ms / 1000}s
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <FilterBar
                filter={filter}
                onChange={handleFilterChange}
                latestRoundNumber={latestRoundNumber}
                activePreset={activePreset}
                onPresetChange={setActivePreset}
                {...(filterBarRef !== undefined && { handleRef: filterBarRef })}
            />

            <LogsDiffBanner entries={allEntries} />

            {rounds.length === 0 && <p className="log-feed__empty">No data yet — waiting for first sync.</p>}

            {rounds.map((round) => {
                const entries = applyFilter(
                    allEntries.filter((e) => {
                        const r = 'round' in e ? e.round : null;
                        return r === round.roundNumber;
                    }),
                );
                if (filter.roundNumber !== null && round.roundNumber !== filter.roundNumber) return null;

                return (
                    <RoundGroup
                        key={`${round.id}-${expandedRoundNumber}`}
                        round={round}
                        entries={entries}
                        timeZone={tz}
                        tournamentId={activeTournamentId ?? 0}
                        defaultCollapsed={expandedRoundNumber !== null && round.roundNumber !== expandedRoundNumber}
                        isEntryNew={isEntryNew}
                        onExpandChange={(collapsed) => handleRoundExpand(round.roundNumber, collapsed)}
                    />
                );
            })}
        </div>
    );
};
