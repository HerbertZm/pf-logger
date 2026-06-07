import type { ReportColumnDef } from './reportColumns';
import type { RoundTimingReportRow } from '../../api/types';
import { formatInTournamentTz } from '../../utils/time';

export function formatReportClock(isoUtc: string | null, timeZone: string): string {
    if (isoUtc === null) return '—';
    return formatInTournamentTz(isoUtc, timeZone, { hour: 'numeric', minute: '2-digit' });
}

export function formatDurationHm(totalSec: number | null): string {
    if (totalSec === null) return '—';
    const sec = Math.max(0, Math.round(totalSec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h${m}m`;
}

export function formatDurationMs(totalSec: number | null): string {
    if (totalSec === null) return '—';
    const sec = Math.max(0, Math.round(totalSec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    return s === 0 ? `${m}m` : `${m}m${s}s`;
}

export function formatExtensionMax(totalSec: number | null): string {
    if (totalSec === null) return '—';
    const m = Math.round(totalSec / 60);
    return `${m}m`;
}

export function formatReportCell(row: RoundTimingReportRow, col: ReportColumnDef, timeZone: string): string {
    const value = row[col.key];

    switch (col.kind) {
        case 'round':
            return String(value);
        case 'clock':
            return formatReportClock(value as string | null, timeZone);
        case 'duration-hm':
            return formatDurationHm(value as number | null);
        case 'duration-ms':
            return formatDurationMs(value as number | null);
        case 'count':
            return value === null ? '—' : String(value);
        case 'extension':
            return formatExtensionMax(value as number | null);
        default:
            return '—';
    }
}
