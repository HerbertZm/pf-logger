import './StatChips.css';
import type { ActiveRoundResponse } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';

interface StatChipsProps {
  data: ActiveRoundResponse;
}

const val = (n: number) => (n === 0 ? '—' : String(n));

export const StatChips = ({ data }: StatChipsProps) => {
  const { sources } = useTournament();

  return (
    <div className="stat-chips">
      <div className="stat-chip stat-chip--urgent">
        <span
          className={`stat-chip__value${data.outstandingTables.length === 0 ? ' value-zero' : ''}`}
        >
          {val(data.outstandingTables.length)}
        </span>
        <span className="stat-chip__label">Outstanding</span>
      </div>

      <div className="stat-chip stat-chip--warning">
        <span
          className={`stat-chip__value${data.tablesWithExtensions.length === 0 ? ' value-zero' : ''}`}
        >
          {val(data.tablesWithExtensions.length)}
        </span>
        <span className="stat-chip__label">w/ Extensions</span>
      </div>

      {sources.pf && (
        <div className="stat-chip stat-chip--muted">
          <span className={`stat-chip__value${data.dropCount === 0 ? ' value-zero' : ''}`}>
            {val(data.dropCount)}
          </span>
          <span className="stat-chip__label">Drops</span>
        </div>
      )}

      <div className="stat-chip stat-chip--penalty">
        <span className={`stat-chip__value${data.penaltyCount === 0 ? ' value-zero' : ''}`}>
          {val(data.penaltyCount)}
        </span>
        <span className="stat-chip__label">Penalties</span>
      </div>
    </div>
  );
};
