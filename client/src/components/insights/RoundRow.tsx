import { useState } from 'react';
import './RoundRow.css';
import type { Round, RoundSummary } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';
import { ExtensionHistogram } from './ExtensionHistogram';
import { operationalExtensionCount } from '../../utils/extensions';
import { useRoundPace } from '../../hooks/useRoundPace';
import { RoundOperatorNotes } from './RoundOperatorNotes';

interface RoundRowProps {
    summary: RoundSummary;
    logisticsThresholdMin: number;
    onRoundUpdated: (round: Round) => void;
}

const val = (n: number | null) => (n === null || n === 0 ? '—' : String(n));

const seatingGap = (r: Round): string => {
    if (!r.startedAt || !r.playStartedAt) return '—';
    const sec = Math.round((new Date(r.playStartedAt).getTime() - new Date(r.startedAt).getTime()) / 1000);
    if (sec <= 0) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    if (s === 0) return `${m}m`;
    return `${m}m ${s}s`;
};

const rowUrgency = (s: RoundSummary): 'urgent' | 'warning' | '' => {
    if ((s.overtimeMinutes ?? 0) > 15 || s.outstandingAtTimeCalled >= 5) return 'urgent';
    if ((s.overtimeMinutes ?? 0) > 0 || s.outstandingAtTimeCalled >= 1) return 'warning';
    return '';
};

export const RoundRow = ({ summary, logisticsThresholdMin, onRoundUpdated }: RoundRowProps) => {
    const [expanded, setExpanded] = useState(false);
    const { sources } = useTournament();
    const urgency = rowUrgency(summary);
    const r = summary.round;
    const pace = useRoundPace(r);
    const opsExtensionCount = operationalExtensionCount(summary.extensions, logisticsThresholdMin);

    const handleNotesSaved = (round: Round): void => {
        onRoundUpdated(round);
    };

    return (
        <>
            <tr
                className={`round-row${urgency ? ` round-row--${urgency}` : ''}`}
                onClick={() => setExpanded((e) => !e)}
            >
                <td className="round-row__rd">{r.roundNumber}</td>
                <td className="round-row__status">
                    {r.cardeStatus ?? '—'}
                    {pace !== null && (
                        <span className={`round-row__pace round-row__pace--${pace.level}`}>{pace.label}</span>
                    )}
                </td>
                {sources.pf && (
                    <td className={`round-row__num${summary.dropCount === 0 ? ' value-zero' : ''}`}>
                        {val(summary.dropCount)}
                    </td>
                )}
                <td className={`round-row__num${opsExtensionCount === 0 ? ' value-zero' : ''}`}>
                    {val(opsExtensionCount)}
                </td>
                <td className={`round-row__num${summary.outstandingAtTimeCalled === 0 ? ' value-zero' : ''}`}>
                    {val(summary.outstandingAtTimeCalled)}
                </td>
                <td className="round-row__num value-zero" title="Requires ingestion worker — not yet available">
                    {summary.overtimeMinutes !== null ? `${val(summary.overtimeMinutes)}m` : 'n/a'}
                </td>
                <td className="round-row__num" title="Time between round start and play start (seating + announcements)">
                    {seatingGap(r)}
                </td>
                <td className="round-row__actions">
                    <span className="round-row__expand" aria-hidden="true">
                        {expanded ? '▲' : '▼'}
                    </span>
                </td>
            </tr>

            {expanded && (
                <tr className="round-row__detail">
                    <td colSpan={sources.pf ? 8 : 7}>
                        <ExtensionHistogram
                            extensions={summary.extensions}
                            logisticsThresholdMin={logisticsThresholdMin}
                        />
                        {summary.round.missingTablesJson !== null && summary.round.missingTablesJson.length > 0 && (
                            <p className="round-row__tables">
                                Outstanding at time called: {summary.round.missingTablesJson.join(', ')}
                            </p>
                        )}
                        <RoundOperatorNotes round={r} onSaved={handleNotesSaved} />
                    </td>
                </tr>
            )}
        </>
    );
};
