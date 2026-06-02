import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { LogsResponse } from '../api/types';

const POLL_MS = 20_000;

/** Polls /api/logs and returns a badge count of entries added since the user last opened Logs. */
export function useLogsBadge(tournamentId: number | null, logsTabActive: boolean): number {
    const [badge, setBadge] = useState(0);
    const lastSeenCountRef = useRef(0);

    useEffect(() => {
        lastSeenCountRef.current = 0;
        setBadge(0);
    }, [tournamentId]);

    useEffect(() => {
        if (!tournamentId) return;

        const poll = (): void => {
            api.get<LogsResponse>(`/api/logs?tournamentId=${tournamentId}`)
                .then((data) => {
                    const count = data.entries.length;
                    if (logsTabActive) {
                        lastSeenCountRef.current = count;
                        setBadge(0);
                        return;
                    }
                    setBadge(Math.max(0, count - lastSeenCountRef.current));
                })
                .catch(() => {
                    /* ignore — badge is best-effort */
                });
        };

        poll();
        if (logsTabActive) {
            return;
        }
        const id = setInterval(poll, POLL_MS);
        return () => clearInterval(id);
    }, [tournamentId, logsTabActive]);

    return badge;
}
