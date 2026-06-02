import { useEffect, useState } from 'react';
import './CrossRoundSummary.css';
import { api } from '../../api/client';
import type { RoundSummary } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';
import { Banner } from '../shared/Banner';
import { RoundRow } from './RoundRow';

const POLL_MS = 30_000;

export const CrossRoundSummary = () => {
    const { activeTournamentId, sources } = useTournament();
    const [data, setData] = useState<RoundSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!activeTournamentId) return;
        const fetch = () =>
            api
                .get<RoundSummary[]>(`/api/insights?tournamentId=${activeTournamentId}`)
                .then((d) => {
                    setData(d);
                    setLoading(false);
                    setError(null);
                })
                .catch((e: Error) => {
                    setError(e.message);
                    setLoading(false);
                });
        void fetch();
        const id = setInterval(() => {
            void fetch();
        }, POLL_MS);
        return () => clearInterval(id);
    }, [activeTournamentId]);

    if (loading) return <div className="cross-round__skeleton skeleton" />;
    if (error) return <Banner variant="error" message={error} />;
    if (data.length === 0) {
        return <p className="cross-round__empty">No rounds yet — waiting for first sync.</p>;
    }

    // Totals
    const totals = data.reduce(
        (acc, s) => ({
            drops: acc.drops + s.dropCount,
            extensions: acc.extensions + s.extensionCount,
            penalties: acc.penalties + s.penaltyCount,
        }),
        { drops: 0, extensions: 0, penalties: 0 },
    );

    return (
        <div className="cross-round">
            <div className="cross-round__totals">
                {sources.pf && (
                    <span className="cross-round__total">
                        <strong>{totals.drops}</strong> drops
                    </span>
                )}
                <span className="cross-round__total">
                    <strong>{totals.extensions}</strong> extensions
                </span>
                <span className="cross-round__total">
                    <strong>{totals.penalties}</strong> penalties
                </span>
            </div>

            <div className="cross-round__table-wrap">
                <table className="cross-round__table">
                    <thead>
                        <tr>
                            <th>Rd</th>
                            <th>Status</th>
                            {sources.pf && <th>Drops</th>}
                            <th>Extensions</th>
                            <th title="Tables with outstanding results when the round clock expired">Late Tables</th>
                            <th title="Minutes past timer expiry before last result — requires ingestion worker">
                                Overtime (min)
                            </th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((s) => (
                            <RoundRow key={s.round.id} summary={s} />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
