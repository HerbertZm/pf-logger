import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { AdminTournament, AppEventSummary, SourceMapping } from '../../api/adminTypes';
import type { Game } from '../../api/types';
import { ALL_TIMEZONES, COMMON_TIMEZONES } from '../../constants/timezones';
import { Banner } from '../shared/Banner';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';

const sourceLabel = (t: AdminTournament): string => {
    const pf = t.sources.pf;
    const carde = t.sources.carde;
    if (pf && carde) return 'PF+CARDE';
    if (carde) return 'CARDE ONLY';
    if (pf) return 'PF ONLY';
    return 'NONE';
};

export const TournamentPanel = () => {
    const [tournaments, setTournaments] = useState<AdminTournament[]>([]);
    const [events, setEvents] = useState<AppEventSummary[]>([]);
    const [games, setGames] = useState<Game[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [shortName, setShortName] = useState('');
    const [gameId, setGameId] = useState('');
    const [eventId, setEventId] = useState('');
    const [timezone, setTimezone] = useState<string>(COMMON_TIMEZONES[0]);
    const [timezoneOverride, setTimezoneOverride] = useState(false);
    const [venue, setVenue] = useState('');
    const [cardeId, setCardeId] = useState('');
    const [pfId, setPfId] = useState('');
    const [creating, setCreating] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [resetScenario, setResetScenario] = useState('default');

    const load = useCallback((): void => {
        setLoading(true);
        Promise.all([
            api.get<AdminTournament[]>('/api/admin/tournaments'),
            api.get<Game[]>('/api/games'),
            api.get<AppEventSummary[]>('/api/admin/events'),
        ])
            .then(([tList, gList, eList]) => {
                setTournaments(tList);
                setGames(gList);
                setEvents(eList.filter((e) => e.isActive));
                setGameId((prev) => (prev === '' && gList.length > 0 ? String(gList[0].id) : prev));
                setError(null);
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (!eventId || timezoneOverride) return;
        const ev = events.find((e) => String(e.id) === eventId);
        if (ev) {
            setTimezone(ev.timezone);
            if (!venue && ev.venue) setVenue(ev.venue);
        }
    }, [eventId, events, timezoneOverride, venue]);

    const handleCreate = (): void => {
        const sources: Array<{ source: string; externalId: string }> = [];
        if (cardeId.trim()) sources.push({ source: 'carde', externalId: cardeId.trim() });
        if (pfId.trim()) sources.push({ source: 'purplefox', externalId: pfId.trim() });
        if (sources.length === 0) {
            setError('At least one source external ID is required');
            return;
        }
        setCreating(true);
        const body: Record<string, unknown> = {
            name,
            shortName,
            gameId: Number(gameId),
            sources,
            venue: venue.trim() || null,
        };
        if (eventId) {
            body['eventId'] = Number(eventId);
            if (timezoneOverride) {
                body['timezoneOverride'] = true;
                body['timezone'] = timezone;
            }
        } else {
            body['timezone'] = timezone;
        }
        api.post<AdminTournament>('/api/admin/tournaments', body)
            .then(() => {
                setName('');
                setShortName('');
                setCardeId('');
                setPfId('');
                setVenue('');
                setEventId('');
                load();
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setCreating(false));
    };

    const notifyTournamentsChanged = (): void => {
        window.dispatchEvent(new Event('tournaments:refresh'));
    };

    const patchTournament = (id: number, body: Record<string, unknown>): void => {
        api.patch<AdminTournament>(`/api/admin/tournaments/${id}`, body)
            .then(() => {
                load();
                notifyTournamentsChanged();
            })
            .catch((e: Error) => setError(e.message));
    };

    const endTournament = (id: number): void => {
        if (!window.confirm('End this tournament? Ingestion will stop.')) return;
        api.post<{ ok: boolean }>('/api/end-tournament', { tournamentId: id })
            .then(() => {
                load();
                notifyTournamentsChanged();
            })
            .catch((e: Error) => setError(e.message));
    };

    const reactivateTournament = (id: number): void => {
        if (!window.confirm('Reactivate this tournament and resume ingestion?')) return;
        patchTournament(id, { isActive: true, isEnded: false });
    };

    const toggleSource = (tournamentId: number, source: string, isEnabled: boolean): void => {
        api.patch<SourceMapping>(`/api/admin/tournaments/${tournamentId}/sources`, { source, isEnabled })
            .then(() => {
                load();
                notifyTournamentsChanged();
            })
            .catch((e: Error) => setError(e.message));
    };

    const editExternalId = (t: AdminTournament, source: 'carde' | 'purplefox'): void => {
        const label = source === 'carde' ? 'Carde event ID' : 'PF tournament UUID';
        const current = t.sourceMappings.find((m) => m.source === source)?.externalId ?? '';
        const next = window.prompt(label, current);
        if (next === null || next.trim() === '') return;
        api.patch<SourceMapping>(`/api/admin/tournaments/${t.id}/sources`, {
            source,
            externalId: next.trim(),
        })
            .then(() => {
                load();
                window.dispatchEvent(new Event('tournaments:refresh'));
            })
            .catch((e: Error) => setError(e.message));
    };

    const softDelete = (id: number): void => {
        if (!window.confirm('Deactivate this tournament?')) return;
        api.delete<{ ok: boolean }>(`/api/admin/tournaments/${id}`)
            .then(() => load())
            .catch((e: Error) => setError(e.message));
    };

    const resetTest = (): void => {
        if (!window.confirm(`Reset local test tournament data (scenario: ${resetScenario})?`)) return;
        setResetting(true);
        api.post<{ ok: boolean }>('/api/admin/reset-test-tournament', { scenario: resetScenario })
            .then(() => {
                load();
                notifyTournamentsChanged();
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setResetting(false));
    };

    if (loading) return <div className="skeleton" style={{ minHeight: 120 }} />;

    const tzLocked = Boolean(eventId) && !timezoneOverride;

    return (
        <section>
            <div className="manage-section__header-row">
                <h2 className="manage-section__title">Tournaments</h2>
                <div className="manage-form">
                    <label>
                        Test scenario
                        <select value={resetScenario} onChange={(e) => setResetScenario(e.target.value)}>
                            <option value="default">Default (R5 ~40m left)</option>
                            <option value="late">Late (R5 ~2m left)</option>
                            <option value="overtime">Overtime (R5 expired, outstanding tables)</option>
                            <option value="top8">Top 8 (R6, no timer)</option>
                        </select>
                    </label>
                    <Button variant="secondary" size="sm" loading={resetting} onClick={resetTest}>
                        Reset test data
                    </Button>
                </div>
            </div>
            {error !== null && <Banner variant="error" message={error} />}
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
                    Game
                    <select value={gameId} onChange={(e) => setGameId(e.target.value)}>
                        {games.map((g) => (
                            <option key={g.id} value={g.id}>
                                {g.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Event (optional)
                    <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
                        <option value="">Standalone</option>
                        {events.map((ev) => (
                            <option key={ev.id} value={ev.id}>
                                {ev.shortName} ({ev.timezone})
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Timezone
                    <select
                        value={timezone}
                        disabled={tzLocked}
                        onChange={(e) => setTimezone(e.target.value)}
                    >
                        {ALL_TIMEZONES.map((tz) => (
                            <option key={tz} value={tz}>
                                {tz}
                            </option>
                        ))}
                    </select>
                </label>
                {eventId && (
                    <label className="manage-form__checkbox">
                        <input
                            type="checkbox"
                            checked={timezoneOverride}
                            onChange={(e) => setTimezoneOverride(e.target.checked)}
                        />
                        Override event timezone
                    </label>
                )}
                <label>
                    Venue (optional)
                    <input value={venue} onChange={(e) => setVenue(e.target.value)} />
                </label>
                <label>
                    Carde external ID
                    <input value={cardeId} onChange={(e) => setCardeId(e.target.value)} />
                </label>
                <label>
                    PF external ID (UUID)
                    <input value={pfId} onChange={(e) => setPfId(e.target.value)} />
                </label>
                <Button type="submit" variant="primary" loading={creating}>
                    Add tournament
                </Button>
            </form>
            <div className="manage-table-wrap">
                <table className="manage-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>TZ</th>
                            <th>Source</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[...tournaments]
                            .sort((a, b) => {
                                const aOff = a.isEnded || a.deletedAt !== null ? 1 : 0;
                                const bOff = b.isEnded || b.deletedAt !== null ? 1 : 0;
                                if (aOff !== bOff) return aOff - bOff;
                                return a.name.localeCompare(b.name);
                            })
                            .map((t) => (
                            <tr key={t.id}>
                                <td className="manage-tournament-name">
                                    <span>{t.name}</span>
                                    {t.isTestTournament && <Badge icon="T" label="TEST" variant="warning" />}
                                </td>
                                <td title={t.event?.name ?? undefined}>{t.timezone}</td>
                                <td>
                                    <Badge icon="S" label={sourceLabel(t)} variant="info" />
                                </td>
                                <td>
                                    {t.deletedAt !== null && t.deletedAt !== undefined
                                        ? 'Deactivated'
                                        : t.isEnded
                                          ? 'Ended'
                                          : t.isActive
                                            ? 'Active'
                                            : 'Inactive'}
                                </td>
                                <td>
                                    <div className="manage-row-actions">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => {
                                                toggleSource(t.id, 'carde', !t.sources.carde);
                                            }}
                                        >
                                            {t.sources.carde ? 'Disable Carde' : 'Enable Carde'}
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => {
                                                toggleSource(t.id, 'purplefox', !t.sources.pf);
                                            }}
                                        >
                                            {t.sources.pf ? 'Disable PF' : 'Enable PF'}
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => editExternalId(t, 'carde')}>
                                            Carde ID
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => editExternalId(t, 'purplefox')}
                                        >
                                            PF ID
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => {
                                                const next = window.prompt('Tournament name', t.name);
                                                const trimmed = next?.trim();
                                                if (trimmed) {
                                                    patchTournament(t.id, { name: trimmed });
                                                }
                                            }}
                                        >
                                            Rename
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                const next = window.prompt('IANA timezone', t.timezone);
                                                if (next?.trim()) {
                                                    patchTournament(t.id, { timezone: next.trim() });
                                                }
                                            }}
                                        >
                                            Timezone
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                const next = window.prompt('Venue (optional)', t.venue ?? '');
                                                if (next !== null) {
                                                    patchTournament(t.id, {
                                                        venue: next.trim() === '' ? null : next.trim(),
                                                    });
                                                }
                                            }}
                                        >
                                            Venue
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => {
                                                if (t.eventId && window.confirm('Re-apply timezone from linked event?')) {
                                                    patchTournament(t.id, {
                                                        applyEventTimezone: true,
                                                        eventId: t.eventId,
                                                    });
                                                }
                                            }}
                                            disabled={!t.eventId}
                                        >
                                            Sync TZ
                                        </Button>
                                        {!t.isEnded && t.deletedAt === null && (
                                            <Button variant="warning" size="sm" onClick={() => endTournament(t.id)}>
                                                End
                                            </Button>
                                        )}
                                        {(t.deletedAt !== null ||
                                            !t.isActive ||
                                            (t.isEnded && t.deletedAt === null)) && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => reactivateTournament(t.id)}
                                            >
                                                Reactivate
                                            </Button>
                                        )}
                                        {t.deletedAt === null && (
                                            <Button variant="danger" size="sm" onClick={() => softDelete(t.id)}>
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
