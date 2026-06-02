import { useEffect, useRef, useState } from 'react';
import './LogsDiffBanner.css';
import type { LogEntry } from '../../api/types';
import { Button } from '../shared/Button';

interface EntryCounts {
    drop: number;
    extension: number;
    penalty: number;
    coverage: number;
    judge_call: number;
}

function countByType(entries: LogEntry[]): EntryCounts {
    const c: EntryCounts = { drop: 0, extension: 0, penalty: 0, coverage: 0, judge_call: 0 };
    for (const e of entries) c[e.type]++;
    return c;
}

interface LogsDiffBannerProps {
    entries: LogEntry[];
}

export const LogsDiffBanner = ({ entries }: LogsDiffBannerProps) => {
    const prevRef = useRef<EntryCounts | null>(null);
    const [diff, setDiff] = useState<EntryCounts | null>(null);
    const [dismissed, setDismissed] = useState(false);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        const current = countByType(entries);
        if (prevRef.current === null) {
            prevRef.current = current;
            return;
        }

        const delta: EntryCounts = {
            drop: Math.max(0, current.drop - prevRef.current.drop),
            extension: Math.max(0, current.extension - prevRef.current.extension),
            penalty: Math.max(0, current.penalty - prevRef.current.penalty),
            coverage: Math.max(0, current.coverage - prevRef.current.coverage),
            judge_call: Math.max(0, current.judge_call - prevRef.current.judge_call),
        };
        prevRef.current = current;

        const total = delta.drop + delta.extension + delta.penalty + delta.coverage + delta.judge_call;
        if (total > 0) {
            setDiff(delta);
            setDismissed(false);
        }
    }, [entries]);

    if (diff === null || dismissed) return null;

    const parts: string[] = [];
    if (diff.drop > 0) parts.push(`${diff.drop} drop${diff.drop === 1 ? '' : 's'}`);
    if (diff.extension > 0) parts.push(`${diff.extension} extension${diff.extension === 1 ? '' : 's'}`);
    if (diff.penalty > 0) parts.push(`${diff.penalty} ${diff.penalty === 1 ? 'penalty' : 'penalties'}`);
    if (diff.coverage > 0) parts.push(`${diff.coverage} coverage`);
    if (diff.judge_call > 0) parts.push(`${diff.judge_call} judge call${diff.judge_call === 1 ? '' : 's'}`);

    if (parts.length === 0) return null;

    return (
        <div className={`logs-diff${collapsed ? ' logs-diff--collapsed' : ''}`}>
            <div className="logs-diff__header">
                <button
                    type="button"
                    className="logs-diff__toggle"
                    onClick={() => setCollapsed((c) => !c)}
                    aria-expanded={!collapsed}
                >
                    Since last refresh: {parts.join(' · ')}
                </button>
                <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
                    Dismiss
                </Button>
            </div>
            {!collapsed && <p className="logs-diff__hint">Counts are cumulative row totals — new rows since the previous poll.</p>}
        </div>
    );
};
