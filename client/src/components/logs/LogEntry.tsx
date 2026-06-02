import './LogEntry.css';
import { Badge } from '../shared/Badge';
import type { LogEntry as LogEntryType } from '../../api/types';

interface LogEntryProps {
    entry: LogEntryType;
}

const BADGE_MAP = {
    drop: { icon: '↓', label: 'Drop', variant: 'urgent' },
    extension: { icon: '+', label: 'Ext', variant: 'warning' },
    penalty: { icon: '!', label: 'Penalty', variant: 'penalty' },
    coverage: { icon: '◈', label: 'Coverage', variant: 'info' },
    judge_call: { icon: '⚖', label: 'Judge', variant: 'muted' },
} as const;

const entryName = (e: LogEntryType): string => {
    if (e.type === 'drop') return e.playerName ?? e.playerGameId;
    if (e.type === 'extension') return `Table ${e.tableNumber}`;
    if (e.type === 'penalty') return e.playerName ?? '—';
    if (e.type === 'coverage') return `Table ${e.tableNumber}`;
    if (e.type === 'judge_call') return `Table ${e.tableNumber}`;
    return '—';
};

const entrySub = (e: LogEntryType): string => {
    if (e.type === 'drop') return `Round ${e.round}${e.tableNumber ? ` · Table ${e.tableNumber}` : ''}`;
    if (e.type === 'extension') return `+${e.extensionMinutes ?? '?'}min`;
    if (e.type === 'penalty') return e.infraction ?? (e.description || '—');
    if (e.type === 'coverage') return e.coveredBy;
    if (e.type === 'judge_call') return e.judgeResult;
    return '';
};

// Secondary staff/judge line shown below the primary sub
const entryStaff = (e: LogEntryType): string | null => {
    if (e.type === 'penalty' && e.creatorName) return `Judge: ${e.creatorName}`;
    if (e.type === 'drop') {
        const parts: string[] = [];
        if (e.addedByName) parts.push(`Added: ${e.addedByName}`);
        if (e.verifiedByName) parts.push(`Checked: ${e.verifiedByName}`);
        return parts.length ? parts.join(' · ') : null;
    }
    if (e.type === 'extension') {
        // TODO: add actual name
        return e.userId ? `Judge: ${e.userId}` : null;
    }
    return null;
};

const entryTime = (e: LogEntryType): string => {
    const d = 'createdAt' in e ? new Date(e.createdAt) : 'firstSeenAt' in e ? new Date(e.firstSeenAt) : null;
    if (!d) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const LogEntry = ({ entry }: LogEntryProps) => {
    const badge = BADGE_MAP[entry.type];

    return (
        <div className={`log-entry log-entry--${entry.type}`}>
            <div className="log-entry__accent" />
            <div className="log-entry__gap" />
            <div className="log-entry__badge">
                <Badge icon={badge.icon} label={badge.label} variant={badge.variant} />
            </div>
            <div className="log-entry__body">
                <span className="log-entry__name">{entryName(entry)}</span>
                <span className="log-entry__sub">{entrySub(entry)}</span>
                {entryStaff(entry) && <span className="log-entry__staff">{entryStaff(entry)}</span>}
            </div>
            <span className="log-entry__time">{entryTime(entry)}</span>
        </div>
    );
};
