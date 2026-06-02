import { useState } from 'react';
import './RoundRow.css';
import type { RoundSummary } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';
import { ExtensionHistogram } from './ExtensionHistogram';

interface RoundRowProps {
  summary: RoundSummary;
}

const val = (n: number | null) => (n === null || n === 0 ? '—' : String(n));

const rowUrgency = (s: RoundSummary): 'urgent' | 'warning' | '' => {
  if ((s.overtimeMinutes ?? 0) > 15 || s.outstandingAtTimeCalled >= 5) return 'urgent';
  if ((s.overtimeMinutes ?? 0) > 0 || s.outstandingAtTimeCalled >= 1) return 'warning';
  return '';
};

export const RoundRow = ({ summary }: RoundRowProps) => {
  const [expanded, setExpanded] = useState(false);
  const { sources } = useTournament();
  const urgency = rowUrgency(summary);
  const r = summary.round;

  return (
    <>
      <tr
        className={`round-row${urgency ? ` round-row--${urgency}` : ''}`}
        onClick={() => setExpanded((e) => !e)}
      >
        <td className="round-row__rd">{r.roundNumber}</td>
        <td className="round-row__status">{r.cardeStatus ?? '—'}</td>
        {sources.pf && (
          <td className={`round-row__num${summary.dropCount === 0 ? ' value-zero' : ''}`}>
            {val(summary.dropCount)}
          </td>
        )}
        <td className={`round-row__num${summary.extensionCount === 0 ? ' value-zero' : ''}`}>
          {val(summary.extensionCount)}
        </td>
        <td className={`round-row__num${summary.outstandingAtTimeCalled === 0 ? ' value-zero' : ''}`}>
          {val(summary.outstandingAtTimeCalled)}
        </td>
        <td className="round-row__num value-zero" title="Requires ingestion worker — not yet available">
          {summary.overtimeMinutes !== null ? `${val(summary.overtimeMinutes)}m` : 'n/a'}
        </td>
        <td className="round-row__expand">{expanded ? '▲' : '▼'}</td>
      </tr>

      {expanded && (
        <tr className="round-row__detail">
          <td colSpan={sources.pf ? 7 : 6}>
            <ExtensionHistogram extensions={summary.extensions} />
            {summary.round.missingTablesJson && summary.round.missingTablesJson.length > 0 && (
              <p className="round-row__tables">
                Outstanding at time called:{' '}
                {(summary.round.missingTablesJson as number[]).join(', ')}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
};
