import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { WorkerStatus } from '../api/types';

interface WorkerState {
  lastSync: Date | null;
  isRunning: boolean;
  error: string | null;
  isStale: boolean;
  pfJwtExpiresAt: Date | null;
}

export const useWorkerStatus = (tournamentId: number | null): WorkerState => {
  const [state, setState] = useState<WorkerState>({
    lastSync: null,
    isRunning: false,
    error: null,
    isStale: false,
    pfJwtExpiresAt: null,
  });

  useEffect(() => {
    if (tournamentId === null) return;

    const fetch = (): void => {
      api
        .get<WorkerStatus>(`/api/worker-status?tournamentId=${tournamentId}`)
        .then((s) => {
          const lastSync = s.lastSync ? new Date(s.lastSync) : null;
          setState({
            lastSync,
            isRunning: s.isRunning,
            error: s.error,
            isStale: lastSync ? Date.now() - lastSync.getTime() > 120_000 : false,
            pfJwtExpiresAt: s.pfJwtExpiresAt ? new Date(s.pfJwtExpiresAt) : null,
          });
        })
        .catch(() => {});
    };

    fetch();
    const id = setInterval(fetch, 10_000);
    return () => clearInterval(id);
  }, [tournamentId]);

  return state;
};
