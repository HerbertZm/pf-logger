import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../db/prisma';
import type { RoundTimingReportRow } from '../api/types';
import { formatWallClock } from '../utils/datetime';

function toIso(d: Date | null | undefined): string | null {
    if (d === null || d === undefined) return null;
    return d.toISOString();
}

function diffSec(start: Date, end: Date): number {
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

function missingTableCount(json: Prisma.JsonValue | null, snapshotCapturedAt: Date | null): number | null {
    if (snapshotCapturedAt === null || json === null) return null;
    if (!Array.isArray(json)) return null;
    return json.filter((n): n is number => typeof n === 'number').length;
}

function scheduledEnd(
    startedAt: Date | null,
    timerDurationMin: number | null,
    timerEndDatetime: Date | null,
    defaultRoundLengthMin: number,
): Date | null {
    if (timerEndDatetime !== null) return timerEndDatetime;
    if (startedAt === null) return null;
    const durationMin = timerDurationMin ?? defaultRoundLengthMin;
    return new Date(startedAt.getTime() + durationMin * 60_000);
}

function maxExtensionSecByRound(
    extensions: { round: number | null; extensionMinutes: number | null }[],
): Map<number, number> {
    const map = new Map<number, number>();
    for (const ext of extensions) {
        if (ext.round === null || ext.extensionMinutes === null) continue;
        const sec = ext.extensionMinutes * 60;
        const prev = map.get(ext.round);
        if (prev === undefined || sec > prev) map.set(ext.round, sec);
    }
    return map;
}

export interface RoundTimingReportResult {
    shortName: string;
    rows: RoundTimingReportRow[];
}

export async function buildRoundTimingReport(tournamentId: number): Promise<RoundTimingReportResult | null> {
    const tournament = await prisma.appTournament.findFirst({
        where: { id: tournamentId, deletedAt: null },
        include: { game: true },
    });
    if (tournament === null) return null;

    const defaultRoundLengthMin = tournament.game.defaultRoundLengthMin;

    const rounds = await prisma.round.findMany({
        where: { tournamentId, phase: 'swiss' },
        orderBy: { roundNumber: 'asc' },
    });

    const [lastResultByRound, extensions] = await Promise.all([
        prisma.match.groupBy({
            by: ['roundNumber'],
            where: {
                tournamentId,
                isBye: false,
                resultAt: { not: null },
            },
            _max: { resultAt: true },
        }),
        prisma.extension.findMany({
            where: { tournamentId, source: 'purplefox' },
            select: { round: true, extensionMinutes: true },
        }),
    ]);

    const lastResultMap = new Map(lastResultByRound.map((g) => [g.roundNumber, g._max.resultAt as Date]));
    const maxExtMap = maxExtensionSecByRound(extensions);

    const rows = rounds.map((round) => {
        const lastMatchResultAt = lastResultMap.get(round.roundNumber) ?? null;
        const scheduledEndAt = scheduledEnd(
            round.startedAt,
            round.timerDurationMin,
            round.timerEndDatetime,
            defaultRoundLengthMin,
        );

        let additionalTimeUsedSec: number | null = null;
        if (lastMatchResultAt !== null && scheduledEndAt !== null) {
            additionalTimeUsedSec = diffSec(scheduledEndAt, lastMatchResultAt);
        }

        // Play time uses Carde started_at until StageTimer provides judge start (roundTimeStart stays null).
        let totalDurationPlaySec: number | null = null;
        if (lastMatchResultAt !== null && round.startedAt !== null) {
            totalDurationPlaySec = diffSec(round.startedAt, lastMatchResultAt);
        }

        return {
            roundNumber: round.roundNumber,
            publishedAt: null,
            roundTimeStart: null,
            roundTimeScheduledEnd: toIso(scheduledEndAt),
            additionalTimeUsedSec,
            totalDurationPlaySec,
            totalDurationSincePublishSec: null,
            seatingTurnoverSec: null,
            tablesPlayingAfterTime: missingTableCount(round.missingTablesJson, round.snapshotCapturedAt),
            maxExtensionSec: maxExtMap.get(round.roundNumber) ?? null,
        };
    });

    return { shortName: tournament.shortName, rows };
}

const DEFAULT_TIMEZONE = 'America/New_York';

type CsvColumnKind = 'round' | 'clock' | 'duration-hm' | 'duration-ms' | 'count' | 'extension';

interface CsvColumn {
    label: string;
    key: keyof RoundTimingReportRow;
    kind: CsvColumnKind;
}

const CSV_COLUMNS: CsvColumn[] = [
    { label: 'Round Number', key: 'roundNumber', kind: 'round' },
    { label: 'Published At', key: 'publishedAt', kind: 'clock' },
    { label: 'Round Time Start', key: 'roundTimeStart', kind: 'clock' },
    { label: 'Round Time Scheduled End', key: 'roundTimeScheduledEnd', kind: 'clock' },
    { label: 'Additional Time Used', key: 'additionalTimeUsedSec', kind: 'duration-ms' },
    { label: 'Total Duration (Play Time)', key: 'totalDurationPlaySec', kind: 'duration-hm' },
    { label: 'Total Duration (Since Publish)', key: 'totalDurationSincePublishSec', kind: 'duration-hm' },
    { label: 'Seating Turnover', key: 'seatingTurnoverSec', kind: 'duration-ms' },
    { label: 'Tables Playing After Time', key: 'tablesPlayingAfterTime', kind: 'count' },
    { label: 'Max Extension', key: 'maxExtensionSec', kind: 'extension' },
];

function formatDurationHm(totalSec: number | null): string {
    if (totalSec === null) return '';
    const sec = Math.max(0, Math.round(totalSec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatDurationMs(totalSec: number | null): string {
    if (totalSec === null) return '';
    const sec = Math.max(0, Math.round(totalSec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    return s === 0 ? `${m}m` : `${m}m${s}s`;
}

function formatExtensionMax(totalSec: number | null): string {
    if (totalSec === null) return '';
    return `${Math.round(totalSec / 60)}m`;
}

function formatCsvCell(row: RoundTimingReportRow, col: CsvColumn, timeZone: string): string {
    const value = row[col.key];
    switch (col.kind) {
        case 'round':
            return String(value);
        case 'clock':
            return formatWallClock(value as string | null, timeZone);
        case 'duration-hm':
            return formatDurationHm(value as number | null);
        case 'duration-ms':
            return formatDurationMs(value as number | null);
        case 'count':
            return value === null ? '' : String(value);
        case 'extension':
            return formatExtensionMax(value as number | null);
        default:
            return '';
    }
}

function escapeCsvField(value: string): string {
    if (/[",\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

export function roundTimingReportToCsv(rows: RoundTimingReportRow[], timeZone: string = DEFAULT_TIMEZONE): string {
    const header = CSV_COLUMNS.map((c) => escapeCsvField(c.label)).join(',');
    const lines = rows.map((row) =>
        CSV_COLUMNS.map((col) => escapeCsvField(formatCsvCell(row, col, timeZone))).join(','),
    );
    return [header, ...lines].join('\r\n') + '\r\n';
}

export function csvFilename(shortName: string): string {
    const safe = shortName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return `round-timing-${safe || 'export'}.csv`;
}
