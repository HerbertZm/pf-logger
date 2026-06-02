import type { RoundTimingReportRow } from '../../api/types';

export interface ReportColumnDef {
    key: keyof RoundTimingReportRow;
    label: string;
    description: string;
    kind: 'round' | 'clock' | 'duration-hm' | 'duration-ms' | 'count' | 'extension';
}

export const ROUND_TIMING_COLUMNS: ReportColumnDef[] = [
    {
        key: 'roundNumber',
        label: 'Round',
        description: 'Swiss round number',
        kind: 'round',
    },
    {
        key: 'publishedAt',
        label: 'Published At',
        description: 'When pairings were published for players to see (Carde)',
        kind: 'clock',
    },
    {
        key: 'roundTimeStart',
        label: 'Round Time Start',
        description: 'Judge "you may begin" — StageTimer / SK log',
        kind: 'clock',
    },
    {
        key: 'roundTimeScheduledEnd',
        label: 'Round Time Scheduled End',
        description: 'Round Time Start + configured round length',
        kind: 'clock',
    },
    {
        key: 'additionalTimeUsedSec',
        label: 'Additional Time Used',
        description: 'Scheduled end → last match result',
        kind: 'duration-ms',
    },
    {
        key: 'totalDurationPlaySec',
        label: 'Total Duration (Play Time)',
        description: 'Round Time Start → last match result',
        kind: 'duration-hm',
    },
    {
        key: 'totalDurationSincePublishSec',
        label: 'Total Duration (Since Publish)',
        description: 'Published At → last match result',
        kind: 'duration-hm',
    },
    {
        key: 'seatingTurnoverSec',
        label: 'Seating Turnover',
        description: 'Published At → Round Time Start',
        kind: 'duration-ms',
    },
    {
        key: 'tablesPlayingAfterTime',
        label: 'Tables Playing After Time',
        description: 'Outstanding tables at timer expiry (snapshot)',
        kind: 'count',
    },
    {
        key: 'maxExtensionSec',
        label: 'Max Extension',
        description: 'Largest table extension in the round (PurpleFox)',
        kind: 'extension',
    },
];
