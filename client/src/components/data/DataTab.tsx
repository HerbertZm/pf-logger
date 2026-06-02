import { useState } from 'react';
import './DataTab.css';
import { api } from '../../api/client';
import { useTournament } from '../../context/TournamentContext';
import { useAuth } from '../../context/AuthContext';
import { Banner } from '../shared/Banner';
import { Button } from '../shared/Button';

const TABLES = [
  'rounds',
  'matches',
  'drops',
  'extensions',
  'penalties',
  'coverage',
  'judge_calls',
] as const;
type TableName = (typeof TABLES)[number];

const PAGE_SIZE = 50;

interface TableData {
  rows: Record<string, unknown>[];
  total: number;
}

interface TableSectionProps {
  name: TableName;
  tournamentId: number;
}

const TableSection = ({ name, tournamentId }: TableSectionProps) => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TableData | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (nextOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<TableData>(
        `/api/data/${name}?tournamentId=${tournamentId}&limit=${PAGE_SIZE}&offset=${nextOffset}`,
      );
      setData((prev) =>
        nextOffset === 0
          ? result
          : { rows: [...(prev?.rows ?? []), ...result.rows], total: result.total },
      );
      setOffset(nextOffset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !data) {
      void load(0);
    }
  };

  const columns = data?.rows[0] ? Object.keys(data.rows[0]) : [];
  const hasMore = data ? data.rows.length < data.total : false;

  return (
    <div className="data-tab__section">
      <button className="data-tab__section-toggle" onClick={handleToggle}>
        <span className="data-tab__section-name">{name}</span>
        {data && <span className="data-tab__section-count">{data.total} rows</span>}
        <span className="data-tab__section-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="data-tab__section-body">
          {error && <Banner variant="error" message={error} />}

          {loading && !data && <div className="data-tab__skeleton skeleton" />}

          {data && data.rows.length === 0 && <p className="data-tab__empty">No rows.</p>}

          {data && data.rows.length > 0 && (
            <div className="data-tab__table-wrap">
              <table className="data-tab__table">
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i}>
                      {columns.map((col) => (
                        <td key={col}>{String(row[col] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasMore && (
            <div className="data-tab__load-more">
              <Button
                variant="ghost"
                size="sm"
                loading={loading}
                onClick={() => void load(offset + PAGE_SIZE)}
              >
                Load more
              </Button>
              <span className="data-tab__load-count">
                {data?.rows.length} / {data?.total}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const DataTab = () => {
  const { activeTournamentId } = useTournament();
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return <div className="data-tab__unauthorized">This section requires admin access.</div>;
  }

  if (!activeTournamentId) {
    return <div className="data-tab__unauthorized">No tournament selected.</div>;
  }

  const tid: number = activeTournamentId;

  return (
    <div className="data-tab">
      <p className="data-tab__note">
        Raw table explorer — read-only. Data reflects the last ingestion cycle.
      </p>
      {TABLES.map((name) => (
        <TableSection key={name} name={name} tournamentId={tid} />
      ))}
    </div>
  );
};
