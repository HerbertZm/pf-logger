import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Banner } from '../shared/Banner';
import { Button } from '../shared/Button';

interface ActivityRow {
    id: number;
    eventType: string;
    username: string;
    ip: string | null;
    detail: string | null;
    createdAt: string;
}

export const ActivityPanel = () => {
    const [rows, setRows] = useState<ActivityRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback((): void => {
        setLoading(true);
        api.get<ActivityRow[]>('/api/admin/activity')
            .then((data) => {
                setRows(data);
                setError(null);
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    if (loading) return <div className="skeleton" style={{ minHeight: 120 }} />;

    return (
        <section>
            <div className="manage-section__header-row">
                <h2 className="manage-section__title">Activity log</h2>
                <Button variant="secondary" size="sm" onClick={load}>
                    Refresh
                </Button>
            </div>
            {error !== null && <Banner variant="error" message={error} />}
            <div className="manage-table-wrap">
                <table className="manage-table manage-table--activity">
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Event</th>
                            <th>User</th>
                            <th>Detail</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.id}>
                                <td>{new Date(r.createdAt).toLocaleString()}</td>
                                <td>{r.eventType}</td>
                                <td>{r.username}</td>
                                <td className="manage-activity__detail">{r.detail ?? '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
};
