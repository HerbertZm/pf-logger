import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { HealthStatusResponse } from '../../api/adminTypes';
import { Banner } from '../shared/Banner';
import { Button } from '../shared/Button';

interface CheckItem {
    id: string;
    label: string;
    ok: boolean;
    detail: string;
}

function buildChecks(health: HealthStatusResponse | null, tournamentCount: number): CheckItem[] {
    if (health === null) {
        return [{ id: 'load', label: 'Health endpoint', ok: false, detail: 'Not loaded' }];
    }
    const items: CheckItem[] = [
        {
            id: 'db',
            label: 'Database',
            ok: health.db === 'ok',
            detail: health.db === 'ok' ? 'Connected' : 'Unreachable',
        },
        {
            id: 'tournaments',
            label: 'Active tournaments',
            ok: tournamentCount > 0,
            detail: tournamentCount > 0 ? `${tournamentCount} configured` : 'None — create or activate one',
        },
        {
            id: 'pfjwt',
            label: 'PF JWT',
            ok: health.pfJwt.inMemory && !health.pfJwt.expired,
            detail: !health.pfJwt.inMemory
                ? 'Not in memory — paste in Session panel'
                : health.pfJwt.expired
                  ? 'Expired — re-paste'
                  : `Valid · set by ${health.pfJwt.setBy ?? 'unknown'}`,
        },
    ];

    const workersOk =
        health.tournaments.length === 0 ||
        health.tournaments.every((t) => t.isRunning || t.lastMatchesFetchedAt !== null);
    items.push({
        id: 'workers',
        label: 'Ingestion workers',
        ok: workersOk,
        detail:
            health.tournaments.length === 0
                ? 'No active tournaments'
                : health.tournaments
                      .map((t) => `${t.name}: ${t.isRunning ? 'running' : 'stopped'}${t.lastError ? ` (${t.lastError})` : ''}`)
                      .join(' · '),
    });

    items.push({
        id: 'manual-sync',
        label: 'Manual sync (optional)',
        ok: true,
        detail: 'Run once from Ingestion tools before doors open if you want a fresh pull',
    });

    return items;
}

export const OpsChecklistPanel = ({ tournamentCount }: { tournamentCount: number }) => {
    const [health, setHealth] = useState<HealthStatusResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback((): void => {
        setLoading(true);
        api.get<HealthStatusResponse>('/api/admin/health')
            .then((data) => {
                setHealth(data);
                setError(null);
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const checks = buildChecks(health, tournamentCount);
    const allOk = checks.every((c) => c.ok) && health?.ok === true;

    return (
        <section className="ops-checklist">
            <div className="ops-checklist__header">
                <h2 className="manage-section__title">Pre-event checklist</h2>
                <Button variant="secondary" size="sm" loading={loading} onClick={refresh}>
                    Refresh
                </Button>
            </div>
            {error !== null && <Banner variant="error" message={error} />}
            <ul className="ops-checklist__list">
                {checks.map((c) => (
                    <li key={c.id} className={`ops-checklist__item${c.ok ? ' ops-checklist__item--ok' : ''}`}>
                        <span className="ops-checklist__mark">{c.ok ? '✓' : '○'}</span>
                        <span className="ops-checklist__label">{c.label}</span>
                        <span className="ops-checklist__detail">{c.detail}</span>
                    </li>
                ))}
            </ul>
            <p className={`ops-checklist__summary${allOk ? ' ops-checklist__summary--ok' : ''}`}>
                {allOk ? 'Ready for event' : 'Resolve items above before going live'}
            </p>
        </section>
    );
};
