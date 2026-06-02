import { useState } from 'react';
import './RoundRow.css';
import type { Round, RoundSummary } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';
import { ExtensionHistogram } from './ExtensionHistogram';
import { operationalExtensionCount } from '../../utils/extensions';
import { useRoundPace } from '../../hooks/useRoundPace';
import { RoundOperatorNotes } from './RoundOperatorNotes';
import { formatRoundSummaryText } from '../../utils/roundSummaryText';
import { Button } from '../shared/Button';

interface RoundRowProps {
    summary: RoundSummary;
    logisticsThresholdMin: number;
    onRoundUpdated: (round: Round) => void;
}

const val = (n: number | null) => (n === null || n === 0 ? '—' : String(n));

const rowUrgency = (s: RoundSummary): 'urgent' | 'warning' | '' => {
    if ((s.overtimeMinutes ?? 0) > 15 || s.outstandingAtTimeCalled >= 5) return 'urgent';
    if ((s.overtimeMinutes ?? 0) > 0 || s.outstandingAtTimeCalled >= 1) return 'warning';
    return '';
};

export const RoundRow = ({ summary, logisticsThresholdMin, onRoundUpdated }: RoundRowProps) => {
    const [expanded, setExpanded] = useState(false);
    const [copyState, setCopyState] = useState<'idle' | 'ok' | 'err'>('idle');
    const { sources, activeTournament } = useTournament();
    const urgency = rowUrgency(summary);
    const r = summary.round;
    const pace = useRoundPace(r);
    const opsExtensionCount = operationalExtensionCount(summary.extensions, logisticsThresholdMin);

    const handleCopy = (): void => {
        const text = formatRoundSummaryText(summary, activeTournament);
        navigator.clipboard
            .writeText(text)
            .then(() => {
                setCopyState('ok');
                window.setTimeout(() => setCopyState('idle'), 2000);
            })
            .catch(() => setCopyState('err'));
    };

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
                <td
                    className="round-row__actions"
                    onClick={(e) => {
                        e.stopPropagation();
                    }}
                >
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            handleCopy();
                        }}
                    >
                        <span className="round-row__copy">
                            {copyState === 'ok' ? 'Copied' : copyState === 'err' ? 'Failed' : 'Copy'}
                        </span>
                    </Button>
                    <span className="round-row__expand" aria-hidden="true">
                        {expanded ? '▲' : '▼'}
                    </span>
                </td>
            </tr>

            {expanded && (
                <tr className="round-row__detail">
                    <td colSpan={sources.pf ? 7 : 6}>
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
