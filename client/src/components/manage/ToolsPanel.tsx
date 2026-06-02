import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { AdminTournament } from '../../api/adminTypes';
import { Banner } from '../shared/Banner';
import { Button } from '../shared/Button';

interface BackfillResponse {
    ok: boolean;
    tournamentId: number;
    rounds: number;
    matches: number;
    drops: number;
    extensions: number;
    penalties: number;
    judgeCalls: number;
    coverage: number;
    error?: string;
}

interface SyncResponse {
    ok: boolean;
    synced?: string[];
    errors?: string[];
    error?: string;
}

export const ToolsPanel = () => {
    const [tournaments, setTournaments] = useState<AdminTournament[]>([]);
    const [tournamentId, setTournamentId] = useState('');
    const [sources, setSources] = useState({ carde: true, purplefox: true });
    const [loading, setLoading] = useState(false);
    const [staffLoading, setStaffLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback((): void => {
        api.get<AdminTournament[]>('/api/admin/tournaments')
            .then((list) => {
                setTournaments(list);
                const active = list.find((t) => t.isActive && !t.isEnded);
                setTournamentId((prev) => prev || (active !== undefined ? String(active.id) : ''));
            })
            .catch((e: Error) => setError(e.message));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const selected = tournaments.find((t) => String(t.id) === tournamentId);

    const run = async (action: 'sync' | 'backfill'): Promise<void> => {
        const id = Number(tournamentId);
        if (!id) {
            setError('Select a tournament');
            return;
        }
        setLoading(true);
        setError(null);
        setMessage(null);
        try {
            if (action === 'sync') {
                const requested: string[] = [];
                if (sources.carde) requested.push('carde');
                if (sources.purplefox) requested.push('purplefox');
                const res = await api.post<SyncResponse>('/api/sync', {
                    tournamentId: id,
                    sources: requested.length > 0 ? requested : undefined,
                });
                if (!res.ok) {
                    setError(res.errors?.join('; ') ?? res.error ?? 'Sync failed');
                    return;
                }
                setMessage(`Sync complete: ${(res.synced ?? []).join(', ') || 'none'}`);
            } else {
                const res = await api.post<BackfillResponse>('/api/backfill', { tournamentId: id });
                setMessage(
                    `Backfill complete — rounds ${res.rounds}, matches ${res.matches}, drops ${res.drops}, extensions ${res.extensions}, penalties ${res.penalties}, judge calls ${res.judgeCalls}, coverage ${res.coverage}`,
                );
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Request failed');
        } finally {
            setLoading(false);
        }
    };

    const runStaffSync = (): void => {
        setStaffLoading(true);
        setError(null);
        setMessage(null);
        api.post<{ upserted: number }>('/api/admin/staff-sync', {})
            .then((res) => setMessage(`PF staff sync complete — ${res.upserted} profiles`))
            .catch((e: Error) => setError(e instanceof Error ? e.message : 'Staff sync failed'))
            .finally(() => setStaffLoading(false));
    };

    return (
        <section>
            <h2 className="manage-section__title">Ingestion tools</h2>
            <p className="manage-config__note">
                Manual sync pulls live data from Carde/PF. Backfill rebuilds normalized tables from stored raw rows
                (no API calls). Ctrl+Enter also triggers sync on the active tournament.
            </p>

            {error !== null && <Banner variant="error" message={error} />}
            {message !== null && <Banner variant="success" message={message} />}

            <div className="manage-form">
                <label>
                    Tournament
                    <select value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}>
                        <option value="">Select…</option>
                        {tournaments.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.shortName || t.name}
                                {t.isTestTournament ? ' (TEST)' : ''}
                                {!t.isActive || t.isEnded ? ' — inactive' : ''}
                            </option>
                        ))}
                    </select>
                </label>

                {selected !== undefined && (
                    <span className="manage-config__note">
                        Sources:{' '}
                        {selected.sources.pf && selected.sources.carde
                            ? 'PF+Carde'
                            : selected.sources.carde
                              ? 'Carde'
                              : selected.sources.pf
                                ? 'PF'
                                : 'none'}
                    </span>
                )}

                <label className="manage-form__checkbox">
                    <input
                        type="checkbox"
                        checked={sources.carde}
                        onChange={(e) => setSources((s) => ({ ...s, carde: e.target.checked }))}
                    />
                    Carde
                </label>
                <label className="manage-form__checkbox">
                    <input
                        type="checkbox"
                        checked={sources.purplefox}
                        onChange={(e) => setSources((s) => ({ ...s, purplefox: e.target.checked }))}
                    />
                    PurpleFox
                </label>

                <Button variant="primary" loading={loading} onClick={() => void run('sync')}>
                    Run sync
                </Button>
                <Button variant="secondary" disabled={loading} onClick={() => void run('backfill')}>
                    Backfill from raw
                </Button>
                <Button variant="secondary" loading={staffLoading} onClick={() => void runStaffSync()}>
                    Sync PF staff
                </Button>
            </div>
            <p className="manage-config__note">
                Staff sync requires a valid PF JWT in the Session panel.
            </p>
        </section>
    );
};
