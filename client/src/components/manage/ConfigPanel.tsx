import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useTournament } from '../../context/TournamentContext';
import { Banner } from '../shared/Banner';
import { Button } from '../shared/Button';

interface AppConfigValues {
    cardePollIntervalMs: number;
    pfPollIntervalMs: number;
    extensionLogisticsThresholdMin: number;
}

export const ConfigPanel = () => {
    const { hideTestTournaments, setHideTestTournaments } = useTournament();
    const [config, setConfig] = useState<AppConfigValues | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [note, setNote] = useState<string | null>(null);

    const load = useCallback((): void => {
        setLoading(true);
        api.get<AppConfigValues & { note?: string }>('/api/admin/config')
            .then((data) => {
                setConfig({
                    cardePollIntervalMs: data.cardePollIntervalMs,
                    pfPollIntervalMs: data.pfPollIntervalMs,
                    extensionLogisticsThresholdMin: data.extensionLogisticsThresholdMin,
                });
                setNote(data.note ?? null);
                setError(null);
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const save = (): void => {
        if (config === null) return;
        setSaving(true);
        api.patch<AppConfigValues & { note?: string }>('/api/admin/config', config)
            .then((data) => {
                setConfig({
                    cardePollIntervalMs: data.cardePollIntervalMs,
                    pfPollIntervalMs: data.pfPollIntervalMs,
                    extensionLogisticsThresholdMin: data.extensionLogisticsThresholdMin,
                });
                setNote(data.note ?? null);
                setError(null);
            })
            .catch((e: Error) => setError(e.message))
            .finally(() => setSaving(false));
    };

    if (loading || config === null) return <div className="skeleton" style={{ minHeight: 80 }} />;

    return (
        <section>
            <h2 className="manage-section__title">App config</h2>
            {error !== null && <Banner variant="error" message={error} />}
            <div className="manage-form manage-form--config">
                <label>
                    Carde poll interval (ms)
                    <input
                        type="number"
                        min={5000}
                        max={300000}
                        step={1000}
                        value={config.cardePollIntervalMs}
                        onChange={(e) =>
                            setConfig((c) =>
                                c ? { ...c, cardePollIntervalMs: Number(e.target.value) } : c,
                            )
                        }
                    />
                </label>
                <label>
                    PF poll interval (ms)
                    <input
                        type="number"
                        min={5000}
                        max={300000}
                        step={1000}
                        value={config.pfPollIntervalMs}
                        onChange={(e) =>
                            setConfig((c) => (c ? { ...c, pfPollIntervalMs: Number(e.target.value) } : c))
                        }
                    />
                </label>
                <label>
                    Logistics extension threshold (min)
                    <input
                        type="number"
                        min={1}
                        max={180}
                        value={config.extensionLogisticsThresholdMin}
                        onChange={(e) =>
                            setConfig((c) =>
                                c ? { ...c, extensionLogisticsThresholdMin: Number(e.target.value) } : c,
                            )
                        }
                    />
                </label>
                <Button variant="primary" loading={saving} onClick={save}>
                    Save config
                </Button>
            </div>
            {note !== null && <p className="manage-config__note">{note}</p>}

            <h3 className="manage-section__title" style={{ marginTop: 'var(--space-6)' }}>
                Display
            </h3>
            <label className="manage-form__checkbox">
                <input
                    type="checkbox"
                    checked={hideTestTournaments}
                    onChange={(e) => setHideTestTournaments(e.target.checked)}
                />
                Hide [TEST] tournaments in selector
            </label>
        </section>
    );
};
