import { useEffect, useState } from 'react';
import './FixedSeatingReport.css';
import { api } from '../../api/client';
import type { FixedSeatEntry, FixedSeatingResponse } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';
import { Banner } from '../shared/Banner';
import { Button } from '../shared/Button';
import { Spinner } from '../shared/Spinner';

export const FixedSeatingReport = () => {
    const { activeTournamentId } = useTournament();
    const [data, setData] = useState<FixedSeatingResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = (tid: number): void => {
        setLoading(true);
        setError(null);
        api.get<FixedSeatingResponse>(`/api/fixed-seating?tournamentId=${tid}`)
            .then((res) => {
                setData(res);
                setLoading(false);
            })
            .catch((e: Error) => {
                setError(e.message);
                setLoading(false);
            });
    };

    useEffect(() => {
        if (activeTournamentId !== null) load(activeTournamentId);
        else { setData(null); setLoading(false); }
    }, [activeTournamentId]);

    const movedCount = data?.entries.filter((e) => e.moved).length ?? 0;

    return (
        <section className="fixed-seating">
            <div className="fixed-seating__header">
                <div className="fixed-seating__header-text">
                    <h2 className="fixed-seating__title">
                        Fixed seating
                        {data?.roundNumber != null && ` — Round ${data.roundNumber}`}
                    </h2>
                    <p className="fixed-seating__subtitle">
                        {data != null
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
                        onClick={() => window.print()}
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
                <FixedSeatingTable entries={data.entries} roundNumber={data.roundNumber} />
            )}
        </section>
    );
};

interface TableProps {
    entries: FixedSeatEntry[];
    roundNumber: number | null;
}

const FixedSeatingTable = ({ entries, roundNumber }: TableProps) => (
    <div className="fixed-seating__table-wrap">
        <table className="fixed-seating__table">
            <thead>
                <tr>
                    <th>Player</th>
                    <th>Fixed seat</th>
                    <th>{roundNumber != null ? `Round ${roundNumber} table` : 'Current table'}</th>
                    <th>Opponent</th>
                </tr>
            </thead>
            <tbody>
                {entries.map((e) => (
                    <tr key={e.fixedSeat} className={e.moved ? 'fixed-seating__row--moved' : undefined}>
                        <td>{e.playerName}</td>
                        <td className="fixed-seating__cell--num">{e.fixedSeat}</td>
                        <td className="fixed-seating__cell--num">
                            {e.currentTable != null ? (
                                <>
                                    {e.currentTable}
                                    {e.moved && <span className="fixed-seating__moved-badge">moved</span>}
                                </>
                            ) : (
                                <span className="fixed-seating__no-pairing">—</span>
                            )}
                        </td>
                        <td>{e.isBye ? <span className="fixed-seating__bye">BYE</span> : (e.opponentName ?? '—')}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);
