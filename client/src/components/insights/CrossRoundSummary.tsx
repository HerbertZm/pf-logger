import { useEffect, useState } from 'react';
import './CrossRoundSummary.css';
import { api } from '../../api/client';
import type { RoundSummary } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';
import { Banner } from '../shared/Banner';
import { RoundComparePanel } from './RoundComparePanel';
import { RoundRow } from './RoundRow';
import { operationalExtensionCount } from '../../utils/extensions';

const POLL_MS = 30_000;

interface PublicConfig {
    extensionLogisticsThresholdMin: number;
}

export const CrossRoundSummary = () => {
    const { activeTournamentId, sources } = useTournament();
    const [data, setData] = useState<RoundSummary[]>([]);
    const [logisticsThreshold, setLogisticsThreshold] = useState(50);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.get<PublicConfig>('/api/config')
            .then((c) => setLogisticsThreshold(c.extensionLogisticsThresholdMin))
            .catch(() => undefined);
    }, []);

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

    let logisticsExcludedTotal = 0;
    const totals = data.reduce(
        (acc, s) => {
            const opsExt = operationalExtensionCount(s.extensions, logisticsThreshold);
            logisticsExcludedTotal += s.extensions.length - opsExt;
            return {
                drops: acc.drops + s.dropCount,
                extensions: acc.extensions + opsExt,
                penalties: acc.penalties + s.penaltyCount,
            };
        },
        { drops: 0, extensions: 0, penalties: 0 },
    );

    const handleRoundUpdated = (roundId: number, round: RoundSummary['round']): void => {
        setData((prev) => prev.map((s) => (s.round.id === roundId ? { ...s, round } : s)));
    };

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
                    {logisticsExcludedTotal > 0 && (
                        <span className="cross-round__logistics-note">
                            {' '}
                            ({logisticsExcludedTotal} logistics ≥{logisticsThreshold}m excluded)
                        </span>
                    )}
                </span>
                <span className="cross-round__total">
                    <strong>{totals.penalties}</strong> penalties
                </span>
            </div>

            <RoundComparePanel summaries={data} logisticsThresholdMin={logisticsThreshold} showPf={sources.pf} />

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
                            <th aria-label="Actions" />
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((s) => (
                            <RoundRow
                                key={s.round.id}
                                summary={s}
                                logisticsThresholdMin={logisticsThreshold}
                                onRoundUpdated={(round) => {
                                    handleRoundUpdated(s.round.id, round);
                                }}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
