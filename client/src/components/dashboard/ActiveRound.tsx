import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { ActiveRoundResponse } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';
import { useRoundTimer } from '../../hooks/useRoundTimer';
import { Banner } from '../shared/Banner';
import { RoundStrip } from './RoundStrip';
import { RoundTimer } from './RoundTimer';
import { StatChips } from './StatChips';
import { OutstandingTables } from './OutstandingTables';
import './ActiveRound.css';

const POLL_MS = 15_000;

export const ActiveRound = () => {
  const { activeTournamentId } = useTournament();
  const [data, setData] = useState<ActiveRoundResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeTournamentId) return;

    const fetch = () =>
      api
        .get<ActiveRoundResponse | null>(`/api/dashboard/active-round?tournamentId=${activeTournamentId}`)
        .then((d) => { setData(d); setLoading(false); setError(null); })
        .catch((e: Error) => { setError(e.message); setLoading(false); });

    fetch();
    const id = setInterval(fetch, POLL_MS);
    return () => clearInterval(id);
  }, [activeTournamentId]);

  const { urgency } = useRoundTimer(data?.round ?? null, data?.outstandingTables.length ?? 0);

  if (loading) return <div className="active-round__skeleton skeleton" />;
  if (error) return <Banner variant="error" message={error} />;
  if (!data?.round) {
    return (
      <div className="active-round__empty">
        No active round — waiting for first sync.
      </div>
    );
  }

  return (
    <div className="active-round">
      <RoundStrip
        round={data.round}
        urgency={urgency}
        isPendingResults={data.round.cardeStatus === 'pending_results'}
      />
      <RoundTimer round={data.round} outstandingCount={data.outstandingTables.length} />
      <StatChips data={data} />
      <OutstandingTables
        tables={data.outstandingTables}
        withExtensions={data.tablesWithExtensions}
      />
    </div>
  );
};
