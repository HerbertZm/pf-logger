import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { AdminUser } from '../../api/adminTypes';
import { useAuth } from '../../context/AuthContext';
import { Banner } from '../shared/Banner';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { formatUtcDateTime } from '../../utils/time';

const ROLES = ['user', 'admin', 'superadmin'] as const;

const roleBadgeVariant = (role: string): 'penalty' | 'warning' | 'info' => {
    if (role === 'superadmin') return 'penalty';
    if (role === 'admin') return 'warning';
    return 'info';
};

const roleLabel = (role: string): string => {
    if (role === 'superadmin') return 'Superadmin';
    if (role === 'admin') return 'Admin';
    return 'User';
};

export const UsersPanel = () => {
    const { username: selfUsername } = useAuth();
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newRole, setNewRole] = useState<string>('user');
    const [creating, setCreating] = useState(false);

    const load = (): void => {
        setLoading(true);
        api.get<AdminUser[]>('/api/admin/users')
            .then((data) => {
                setUsers(data);
                setError(null);
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        load();
    }, []);

    const handleCreate = (): void => {
        setCreating(true);
        api.post<AdminUser>('/api/admin/users', { username: newUsername, password: newPassword, role: newRole })
            .then(() => {
                setNewUsername('');
                setNewPassword('');
                setNewRole('user');
                load();
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setCreating(false));
    };

    const patchUser = (id: number, body: { role?: string; isActive?: boolean; password?: string }): void => {
        api.patch<AdminUser>(`/api/admin/users/${id}`, body)
            .then(() => load())
            .catch((e: Error) => setError(e.message));
    };

    const resetPassword = (u: AdminUser): void => {
        const next = window.prompt(`New password for ${u.username}`, '');
        if (next === null || next.trim() === '') return;
        patchUser(u.id, { password: next });
    };

    if (loading) return <div className="skeleton" style={{ minHeight: 120 }} />;
    if (error !== null) return <Banner variant="error" message={error} />;

    return (
        <section>
            <h2 className="manage-section__title">Users</h2>
            <form
                className="manage-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    handleCreate();
                }}
            >
                <label>
                    Username
                    <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required minLength={3} />
                </label>
                <label>
                    Password
                    <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        minLength={6}
                    />
                </label>
                <label>
                    Role
                    <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                        {ROLES.map((r) => (
                            <option key={r} value={r}>
                                {r}
                            </option>
                        ))}
                    </select>
                </label>
                <Button type="submit" variant="primary" loading={creating}>
                    Create user
                </Button>
            </form>
            <div className="manage-table-wrap">
                <table className="manage-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Role</th>
                            <th>Last login (UTC)</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((u) => {
                            const isSelf = u.username === selfUsername;
                            return (
                                <tr key={u.id}>
                                    <td>{u.username}</td>
                                    <td>
                                        <Badge
                                            icon=""
                                            label={roleLabel(u.role)}
                                            variant={roleBadgeVariant(u.role)}
                                        />
                                    </td>
                                    <td className="manage-table__muted">
                                        {formatUtcDateTime(u.lastLoginAt ?? null)}
                                    </td>
                                    <td>{u.isActive ? 'Active' : 'Inactive'}</td>
                                    <td>
                                        <div className="manage-row-actions">
                                            <select
                                                value={u.role}
                                                disabled={isSelf}
                                                onChange={(e) => {
                                                    patchUser(u.id, { role: e.target.value });
                                                }}
                                            >
                                                {ROLES.map((r) => (
                                                    <option key={r} value={r}>
                                                        {r}
                                                    </option>
                                                ))}
                                            </select>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => resetPassword(u)}
                                            >
                                                Reset password
                                            </Button>
                                            <Button
                                                variant={u.isActive ? 'danger' : 'secondary'}
                                                size="sm"
                                                disabled={isSelf}
                                                onClick={() => {
                                                    patchUser(u.id, { isActive: !u.isActive });
                                                }}
                                            >
                                                {u.isActive ? 'Deactivate' : 'Reactivate'}
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
};
