import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { AppEventSummary } from '../../api/adminTypes';
import { COMMON_TIMEZONES } from '../../constants/timezones';
import { Banner } from '../shared/Banner';
import { Button } from '../shared/Button';

export const EventsPanel = () => {
    const [events, setEvents] = useState<AppEventSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [shortName, setShortName] = useState('');
    const [timezone, setTimezone] = useState<string>(COMMON_TIMEZONES[0]);
    const [venue, setVenue] = useState('');
    const [creating, setCreating] = useState(false);

    const load = useCallback((): void => {
        setLoading(true);
        api.get<AppEventSummary[]>('/api/admin/events')
            .then((data) => {
                setEvents(data);
                setError(null);
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const handleCreate = (): void => {
        setCreating(true);
        api.post<AppEventSummary>('/api/admin/events', {
            name,
            shortName,
            timezone,
            venue: venue.trim() || null,
        })
            .then(() => {
                setName('');
                setShortName('');
                setVenue('');
                load();
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setCreating(false));
    };

    const patchEvent = (id: number, body: Record<string, unknown>): void => {
        api.patch<AppEventSummary>(`/api/admin/events/${id}`, body)
            .then(() => load())
            .catch((e: Error) => setError(e.message));
    };

    if (loading) return <div className="skeleton" style={{ minHeight: 120 }} />;
    if (error !== null) return <Banner variant="error" message={error} />;

    return (
        <section>
            <h2 className="manage-section__title">Events</h2>
            <form
                className="manage-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    handleCreate();
                }}
            >
                <label>
                    Name
                    <input value={name} onChange={(e) => setName(e.target.value)} required />
                </label>
                <label>
                    Short name
                    <input value={shortName} onChange={(e) => setShortName(e.target.value)} required />
                </label>
                <label>
                    Timezone
                    <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                        {COMMON_TIMEZONES.map((tz) => (
                            <option key={tz} value={tz}>
                                {tz}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Venue (optional)
                    <input value={venue} onChange={(e) => setVenue(e.target.value)} />
                </label>
                <Button type="submit" variant="primary" loading={creating}>
                    Create event
                </Button>
            </form>
            <div className="manage-table-wrap">
                <table className="manage-table">
                    <thead>
                        <tr>
                            <th>Event</th>
                            <th>Timezone</th>
                            <th>Tournaments</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {events.map((ev) => (
                            <tr key={ev.id}>
                                <td>{ev.name}</td>
                                <td>{ev.timezone}</td>
                                <td>{ev.tournamentCount}</td>
                                <td>{ev.isActive ? 'Active' : 'Inactive'}</td>
                                <td>
                                    <div className="manage-row-actions">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => {
                                                const cascade = window.confirm(
                                                    'Apply this event timezone to all linked tournaments?',
                                                );
                                                const nextTz = window.prompt('Timezone (IANA)', ev.timezone);
                                                if (nextTz?.trim()) {
                                                    patchEvent(ev.id, {
                                                        timezone: nextTz.trim(),
                                                        applyTimezoneToTournaments: cascade,
                                                    });
                                                }
                                            }}
                                        >
                                            Edit TZ
                                        </Button>
                                        {ev.isActive && (
                                            <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={() => {
                                                    if (window.confirm('Deactivate this event?')) {
                                                        api.delete<AppEventSummary>(`/api/admin/events/${ev.id}`)
                                                            .then(() => load())
                                                            .catch((err: Error) => setError(err.message));
                                                    }
                                                }}
                                            >
                                                Deactivate
                                            </Button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
};
