import type { LogEntry } from '../api/types';

/** Best-effort timestamp for ordering / highlight (UTC ISO). */
export function logEntryTimestamp(entry: LogEntry): string | null {
    if (entry.type === 'extension' || entry.type === 'penalty') return entry.createdAt;
    if (entry.type === 'coverage' || entry.type === 'judge_call') return entry.firstSeenAt;
    return null;
}

export function logEntryKey(entry: LogEntry): string {
    return `${entry.type}-${entry.id}`;
}
