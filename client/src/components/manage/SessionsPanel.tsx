import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { AdminSession } from '../../api/adminTypes';
import { Banner } from '../shared/Banner';
import { Button } from '../shared/Button';

export const SessionsPanel = () => {
    const [sessions, setSessions] = useState<AdminSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = (): void => {
        setLoading(true);
        api.get<AdminSession[]>('/api/admin/sessions')
            .then((data) => {
                setSessions(data);
                setError(null);
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, []);

    const revoke = (id: number): void => {
        api.delete<{ ok: boolean }>(`/api/admin/sessions/${id}`)
            .then(() => load())
            .catch((e: Error) => setError(e.message));
    };

    if (loading) return <div className="skeleton" style={{ minHeight: 120 }} />;
    if (error !== null) return <Banner variant="error" message={error} />;

    return (
        <section>
            <h2 className="manage-section__title">Sessions</h2>
            <div className="manage-table-wrap">
                <table className="manage-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>IP</th>
                            <th>Created</th>
                            <th>Expires</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {sessions.map((s) => (
                            <tr key={s.id}>
                                <td>{s.username}</td>
                                <td>{s.ip ?? '—'}</td>
                                <td>{new Date(s.createdAt).toLocaleString()}</td>
                                <td>{new Date(s.expiresAt).toLocaleString()}</td>
                                <td>
                                    <Button variant="danger" size="sm" onClick={() => revoke(s.id)}>
                                        Revoke
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
};
