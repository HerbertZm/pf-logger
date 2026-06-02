import { useEffect, useMemo, useState } from 'react';
import './RoundSchedulePane.css';
import { api } from '../../api/client';
import type { Round } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';
import { Banner } from '../shared/Banner';
import {
    BREAK_BETWEEN_ROUNDS_MIN,
    buildRoundSchedule,
    defaultRoundLengthMinutes,
    formatDuration,
    formatScheduleTime,
    type RoundScheduleRow,
} from './roundSchedule';

const POLL_MS = 20_000;

const rowState = (row: RoundScheduleRow): 'active' | 'complete' | 'upcoming' => {
    const status = row.round.cardeStatus;
    if (status === 'IN_PROGRESS') return 'active';
    if (status === 'COMPLETE') return 'complete';
    return 'upcoming';
};

export const RoundSchedulePane = () => {
    const { activeTournamentId, activeTournament } = useTournament();
    const [rounds, setRounds] = useState<Round[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (activeTournamentId === null) return;

        const fetch = () =>
            api
                .get<Round[]>(`/api/rounds?tournamentId=${activeTournamentId}`)
                .then((data) => {
                    setRounds(data);
                    setError(null);
                })
                .catch((e: Error) => setError(e.message));

        void fetch();
        const id = setInterval(() => {
            void fetch();
        }, POLL_MS);
        return () => clearInterval(id);
    }, [activeTournamentId]);

    const defaultLength = activeTournament?.game.defaultRoundLengthMinutes ?? defaultRoundLengthMinutes(rounds);
    const overtimeThreshold = defaultLength + BREAK_BETWEEN_ROUNDS_MIN;

    const rows = useMemo(
        () => buildRoundSchedule(rounds, activeTournament?.game.defaultRoundLengthMinutes),
        [rounds, activeTournament?.game.defaultRoundLengthMinutes],
    );

    if (error !== null) {
        return (
            <aside className="round-schedule">
                <Banner variant="error" message={error} />
            </aside>
        );
    }

    return (
        <aside className="round-schedule" aria-label="Round schedule">
            <h2 className="round-schedule__title">Rounds</h2>

            {rows.length === 0 ? (
                <p className="round-schedule__empty">No rounds yet.</p>
            ) : (
                <div className="round-schedule__table-wrap">
                    <table className="round-schedule__table">
                        <thead>
                            <tr>
                                <th>Rd</th>
                                <th>Start</th>
                                <th>End</th>
                                <th>Duration</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => {
                                const state = rowState(row);
                                const isOvertime =
                                    row.durationMinutes !== null && row.durationMinutes > overtimeThreshold;
                                return (
                                    <tr
                                        key={row.round.id}
                                        className={`round-schedule__row round-schedule__row--${state}${isOvertime ? ' round-schedule__row--overtime' : ''}`}
                                    >
                                        <td className="round-schedule__rd">{row.round.roundNumber}</td>
                                        <td
                                            className={`round-schedule__time${row.start?.estimated ? ' round-schedule__time--est' : ''}`}
                                            title={row.start?.estimated ? 'Estimated start' : undefined}
                                        >
                                            {formatScheduleTime(row.start ?? null)}
                                        </td>
                                        <td
                                            className={`round-schedule__time${row.end?.estimated ? ' round-schedule__time--est' : ''}`}
                                            title={row.end?.estimated ? 'Estimated end' : undefined}
                                        >
                                            {formatScheduleTime(row.end ?? null)}
                                        </td>
                                        <td
                                            className={`round-schedule__duration${row.durationEstimated ? ' round-schedule__time--est' : ''}`}
                                            title={
                                                isOvertime
                                                    ? `Over planned slot (${overtimeThreshold}m)`
                                                    : row.durationEstimated
                                                      ? 'Estimated duration'
                                                      : undefined
                                            }
                                        >
                                            {formatDuration(row.durationMinutes)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </aside>
    );
};
