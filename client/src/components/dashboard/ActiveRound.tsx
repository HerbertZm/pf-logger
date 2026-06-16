import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { ActiveRoundResponse, Round } from '../../api/types';
import { useDashboardRoundRequired } from '../../context/DashboardRoundContext';
import { useTournament } from '../../context/TournamentContext';
import { useRoundTimer } from '../../hooks/useRoundTimer';
import { useRoundPace } from '../../hooks/useRoundPace';
import { formatInTournamentTz } from '../../utils/time';
import { Banner } from '../shared/Banner';
import { RoundStrip } from './RoundStrip';
import { RoundTimer } from './RoundTimer';
import { StatChips } from './StatChips';
import { OutstandingTables } from './OutstandingTables';
import './ActiveRound.css';

const POLL_MS = 15_000;

export const ActiveRound = () => {
    const { activeTournamentId, activeTournament } = useTournament();
    const tz = activeTournament?.timezone ?? 'America/New_York';
    const { selectedRoundNumber, setSelectedRoundNumber } = useDashboardRoundRequired();
    const [rounds, setRounds] = useState<Round[]>([]);
    const [data, setData] = useState<ActiveRoundResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Fetch round list for selector
    useEffect(() => {
        if (!activeTournamentId) return;
        api.get<Round[]>(`/api/rounds?tournamentId=${activeTournamentId}`)
            .then(setRounds)
            .catch(() => {});
    }, [activeTournamentId]);

    // Fetch active-round data, re-runs when tournament or selected round changes
    useEffect(() => {
        if (!activeTournamentId) return;

        const url = selectedRoundNumber
            ? `/api/dashboard/active-round?tournamentId=${activeTournamentId}&roundNumber=${selectedRoundNumber}`
            : `/api/dashboard/active-round?tournamentId=${activeTournamentId}`;

        const fetch = () =>
            api
                .get<ActiveRoundResponse | null>(url)
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
    }, [activeTournamentId, selectedRoundNumber]);

    const extensionTotals = new Map<number, number>();
    for (const ext of data?.extensions ?? []) {
        if (ext.tableNumber !== null) {
            extensionTotals.set(ext.tableNumber, (extensionTotals.get(ext.tableNumber) ?? 0) + (ext.extensionMinutes ?? 0));
        }
    }

    const { urgency } = useRoundTimer(data?.round ?? null, data?.outstandingTables.length ?? 0);
    const pace = useRoundPace(data?.round ?? null);
    const showPaceAlert =
        selectedRoundNumber === null && pace !== null && pace.level === 'significantly_over';

    if (loading) return <div className="active-round__skeleton skeleton" />;
    if (error) return <Banner variant="error" message={error} />;
    if (!data?.round) {
        return <div className="active-round__empty">No active round — waiting for first sync.</div>;
    }

    return (
        <div className="active-round">
            {showPaceAlert && (
                <Banner
                    variant="error"
                    message={`Round ${data.round.roundNumber} is ${pace.overMinutes} minutes past time called — check outstanding tables.`}
                />
            )}
            {/* Round selector — shown when historical data is available */}
            {rounds.length > 0 && (
                <div className="active-round__selector">
                    <button
                        className={`round-pill${selectedRoundNumber === null ? ' round-pill--active' : ''}`}
                        onClick={() => setSelectedRoundNumber(null)}
                    >
                        Live
                    </button>
                    {rounds.map((r) => (
                        <button
                            key={r.id}
                            className={`round-pill${selectedRoundNumber === r.roundNumber ? ' round-pill--active' : ''}`}
                            onClick={() => setSelectedRoundNumber(r.roundNumber)}
                        >
                            R{r.roundNumber}
                        </button>
                    ))}
                </div>
            )}

            <RoundStrip
                round={data.round}
                urgency={urgency}
                isPendingResults={data.round.cardeStatus === 'pending_results'}
            />
            <RoundTimer
                round={data.round}
                outstandingCount={data.outstandingTables.length}
                timeZone={tz}
            />
            <StatChips data={data} />
            <OutstandingTables tables={data.outstandingTables} withExtensions={data.tablesWithExtensions} extensionTotals={extensionTotals} />

            {/* Extensions table for selected round */}
            {data.extensions.length > 0 && (
                <div className="active-round__extensions">
                    <p className="active-round__extensions-title">Extensions — Round {data.round.roundNumber}</p>
                    <table className="active-round__ext-table">
                        <thead>
                            <tr>
                                <th>Table</th>
                                <th>From</th>
                                <th>To</th>
                                <th>+min</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.extensions.map((e) => (
                                <tr key={e.id}>
                                    <td>{e.tableNumber}</td>
                                    <td>{e.fromMinutes !== null ? `${e.fromMinutes}m` : '—'}</td>
                                    <td>{e.toMinutes !== null ? `${e.toMinutes}m` : '—'}</td>
                                    <td className="ext-table__delta">+{e.extensionMinutes ?? '?'}m</td>
                                    <td className="ext-table__time">{formatInTournamentTz(e.createdAt, tz)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
