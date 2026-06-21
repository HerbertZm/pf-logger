import { useEffect, useRef, useState } from 'react';
import './FixedSeatingReport.css';
import { api } from '../../api/client';
import type { FixedSeatEntry, FixedSeatingResponse } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';
import { Banner } from '../shared/Banner';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

// ── Sorting ───────────────────────────────────────────────────────────────────

type SortKey = 'playerName' | 'fixedSeat' | 'currentTable' | 'opponentName';
type SortDir = 'asc' | 'desc';

function sortEntries(entries: FixedSeatEntry[], key: SortKey, dir: SortDir): FixedSeatEntry[] {
    return [...entries].sort((a, b) => {
        let cmp = 0;
        if (key === 'playerName') {
            cmp = a.playerName.localeCompare(b.playerName);
        } else if (key === 'fixedSeat') {
            cmp = a.fixedSeat - b.fixedSeat;
        } else if (key === 'currentTable') {
            if (a.currentTable === null && b.currentTable === null) cmp = 0;
            else if (a.currentTable === null) cmp = 1;
            else if (b.currentTable === null) cmp = -1;
            else cmp = a.currentTable - b.currentTable;
        } else {
            cmp = (a.opponentName ?? '').localeCompare(b.opponentName ?? '');
        }
        return dir === 'asc' ? cmp : -cmp;
    });
}

// ── Component ─────────────────────────────────────────────────────────────────

export const FixedSeatingReport = () => {
    const { activeTournamentId } = useTournament();
    const [data, setData] = useState<FixedSeatingResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<SortKey>('fixedSeat');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const sectionRef = useRef<HTMLElement>(null);

    const load = (tid: number): void => {
        setLoading(true);
        setError(null);
        api.get<FixedSeatingResponse>(`/api/fixed-seating?tournamentId=${tid}`)
            .then((res) => { setData(res); setLoading(false); })
            .catch((e: Error) => { setError(e.message); setLoading(false); });
    };

    useEffect(() => {
        if (activeTournamentId !== null) load(activeTournamentId);
        else { setData(null); setLoading(false); }
    }, [activeTournamentId]);

    const handleSort = (key: SortKey): void => {
        if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortKey(key); setSortDir('asc'); }
    };

    const handlePrint = (): void => {
        const style = document.createElement('style');
        // Use visibility (not display:none) so children can override with visibility:visible.
        // position:absolute top:0 collapses the blank space left by hidden sibling elements.
        style.textContent = [
            '@media print {',
            '  body > * { visibility: hidden; }',
            '  .fixed-seating, .fixed-seating * { visibility: visible; }',
            '  .fixed-seating { position: absolute; top: 0; left: 0; width: 100%; margin: 0; }',
            '}',
        ].join('\n');
        document.head.appendChild(style);
        const cleanup = (): void => {
            document.head.removeChild(style);
            window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
        window.print();
    };

    const movedCount = data?.entries.filter((e) => e.moved).length ?? 0;
    const sortedEntries = data ? sortEntries(data.entries, sortKey, sortDir) : [];

    return (
        <section className="fixed-seating" ref={sectionRef}>
            <div className="fixed-seating__header">
                <div className="fixed-seating__header-text">
                    <h2 className="fixed-seating__title">
                        Fixed seating
                        {data?.roundNumber !== null && data?.roundNumber !== undefined && ` — Round ${data.roundNumber}`}
                    </h2>
                    <p className="fixed-seating__subtitle">
                        {data !== null
                            ? `${data.entries.length} fixed-seat player${data.entries.length !== 1 ? 's' : ''}${movedCount > 0 ? ` · ${movedCount} moved` : ''}`
                            : 'Players assigned to permanent seats across all rounds.'}
                    </p>
                </div>
                <div className="fixed-seating__actions">
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={activeTournamentId === null}
                        loading={loading}
                        onClick={() => activeTournamentId !== null && load(activeTournamentId)}
                    >
                        Refresh
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={data === null || data.entries.length === 0}
                        onClick={handlePrint}
                    >
                        Print
                    </Button>
                </div>
            </div>

            {loading && <Spinner />}
            {error !== null && <Banner variant="error" message={error} />}

            {!loading && data !== null && data.entries.length === 0 && (
                <p className="fixed-seating__empty">No fixed-seat players for this tournament.</p>
            )}

            {!loading && data !== null && data.entries.length > 0 && (
                <FixedSeatingTable
                    entries={sortedEntries}
                    roundNumber={data.roundNumber}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                />
            )}
        </section>
    );
};

// ── Table ─────────────────────────────────────────────────────────────────────

interface TableProps {
    entries: FixedSeatEntry[];
    roundNumber: number | null;
    sortKey: SortKey;
    sortDir: SortDir;
    onSort: (key: SortKey) => void;
}

const SortIndicator = ({ active, dir }: { active: boolean; dir: SortDir }) =>
    active ? <span className="fixed-seating__sort-indicator">{dir === 'asc' ? ' ▲' : ' ▼'}</span> : null;

const FixedSeatingTable = ({ entries, roundNumber, sortKey, sortDir, onSort }: TableProps) => (
    <div className="fixed-seating__table-wrap">
        <table className="fixed-seating__table">
            <thead>
                <tr>
                    <th className="fixed-seating__th--sortable" onClick={() => onSort('playerName')}>
                        Player <SortIndicator active={sortKey === 'playerName'} dir={sortDir} />
                    </th>
                    <th className="fixed-seating__th--sortable fixed-seating__cell--num" onClick={() => onSort('fixedSeat')}>
                        Fixed seat <SortIndicator active={sortKey === 'fixedSeat'} dir={sortDir} />
                    </th>
                    <th className="fixed-seating__th--sortable fixed-seating__cell--num" onClick={() => onSort('currentTable')}>
                        {roundNumber !== null ? `Round ${roundNumber} table` : 'Current table'}
                        <SortIndicator active={sortKey === 'currentTable'} dir={sortDir} />
                    </th>
                    <th className="fixed-seating__th--sortable" onClick={() => onSort('opponentName')}>
                        Opponent <SortIndicator active={sortKey === 'opponentName'} dir={sortDir} />
                    </th>
                </tr>
            </thead>
            <tbody>
                {entries.map((e) => (
                    <tr
                        key={e.fixedSeat}
                        className={[
                            e.moved ? 'fixed-seating__row--moved' : '',
                            e.opponentIsFixedSeat ? 'fixed-seating__row--vs-fixed' : '',
                        ].filter(Boolean).join(' ') || undefined}
                    >
                        <td>{e.playerName}</td>
                        <td className="fixed-seating__cell--num">{e.fixedSeat}</td>
                        <td className="fixed-seating__cell--num">
                            {e.currentTable !== null ? (
                                <>
                                    {e.currentTable}
                                    {e.moved && <span className="fixed-seating__moved-badge">moved</span>}
                                </>
                            ) : (
                                <span className="fixed-seating__no-pairing">—</span>
                            )}
                        </td>
                        <td className={e.opponentIsFixedSeat ? 'fixed-seating__cell--vs-fixed' : undefined}>
                            {e.isBye ? (
                                <span className="fixed-seating__bye">BYE</span>
                            ) : (
                                <>
                                    {e.opponentIsFixedSeat && (
                                        <span className="fixed-seating__fs-badge">FS</span>
                                    )}
                                    {e.opponentName ?? '—'}
                                </>
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);
