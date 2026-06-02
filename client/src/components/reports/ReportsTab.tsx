import { useEffect, useState } from 'react';
import './ReportsTab.css';
import { api } from '../../api/client';
import type { RoundTimingReportRow } from '../../api/types';
import { useTournament } from '../../context/TournamentContext';
import { Banner } from '../shared/Banner';
import { Button } from '../shared/Button';
import { RoundTimingColumnGuide } from './RoundTimingColumnGuide';
import { RoundTimingReportTable } from './RoundTimingReportTable';

export const ReportsTab = () => {
    const { activeTournamentId, activeTournament } = useTournament();
    const [rows, setRows] = useState<RoundTimingReportRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);

    const timeZone = activeTournament?.timezone ?? 'America/New_York';

    useEffect(() => {
        if (activeTournamentId === null) {
            setRows([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        api.get<RoundTimingReportRow[]>(`/api/reports/round-timing?tournamentId=${activeTournamentId}`)
            .then((data) => {
                setRows(data);
                setError(null);
                setLoading(false);
            })
            .catch((e: Error) => {
                setError(e.message);
                setLoading(false);
            });
    }, [activeTournamentId]);

    const handleExport = (): void => {
        if (activeTournamentId === null) return;
        setExporting(true);
        setExportError(null);
        const safeName = (activeTournament?.shortName ?? 'export').replace(/[^a-zA-Z0-9_-]+/g, '-');
        const url = `/api/reports/round-timing/export?tournamentId=${activeTournamentId}&timezone=${encodeURIComponent(timeZone)}`;
        api.download(url, `round-timing-${safeName}.csv`)
            .catch((e: Error) => setExportError(e.message))
            .finally(() => setExporting(false));
    };

    return (
        <div className="reports-tab">
            <header className="reports-tab__header">
                <div className="reports-tab__header-text">
                    <h1 className="reports-tab__title">Round timing report</h1>
                    <p className="reports-tab__subtitle">
                        Post-event timing breakdown per Swiss round.
                    </p>
                </div>
                <Button
                    variant="secondary"
                    size="sm"
                    disabled={activeTournamentId === null || rows.length === 0}
                    loading={exporting}
                    onClick={handleExport}
                >
                    Export CSV
                </Button>
            </header>

            {loading && <div className="reports-tab__skeleton skeleton" />}
            {error !== null && <Banner variant="error" message={error} />}
            {exportError !== null && <Banner variant="error" message={exportError} />}
            {!loading && error === null && rows.length === 0 && (
                <p className="reports-tab__empty">No Swiss rounds yet for this tournament.</p>
            )}
            {!loading && error === null && rows.length > 0 && (
                <RoundTimingReportTable rows={rows} timeZone={timeZone} />
            )}
            {!loading && error === null && <RoundTimingColumnGuide />}
        </div>
    );
};
