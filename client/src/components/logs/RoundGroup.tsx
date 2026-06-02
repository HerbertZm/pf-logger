import { useState, useEffect } from 'react';
import './RoundGroup.css';
import { LogEntry } from './LogEntry';
import type { LogEntry as LogEntryType, Round } from '../../api/types';

interface RoundGroupProps {
    round: Round;
    entries: LogEntryType[];
    timeZone: string;
    tournamentId: number;
    defaultCollapsed: boolean;
    isEntryNew: (entry: LogEntryType) => boolean;
    onExpandChange?: (collapsed: boolean) => void;
}

const storageKey = (tournamentId: number, roundId: number) => `round-group-collapsed-${tournamentId}-${roundId}`;

export const RoundGroup = ({
    round,
    entries,
    timeZone,
    tournamentId,
    defaultCollapsed,
    isEntryNew,
    onExpandChange,
}: RoundGroupProps) => {
    const [collapsed, setCollapsed] = useState(() => {
        if (tournamentId > 0) {
            const stored = localStorage.getItem(storageKey(tournamentId, round.id));
            if (stored !== null) return stored === 'true';
        }
        return defaultCollapsed;
    });

    useEffect(() => {
        if (tournamentId <= 0) return;
        localStorage.setItem(storageKey(tournamentId, round.id), String(collapsed));
    }, [collapsed, round.id, tournamentId]);

    return (
        <div className={`round-group ${collapsed ? 'round-group--collapsed' : 'round-group--expanded'}`}>
            <button
                className="round-group__header"
                type="button"
                onClick={() => {
                    setCollapsed((c) => {
                        const next = !c;
                        onExpandChange?.(next);
                        return next;
                    });
                }}
            >
                <span className="round-group__title">Round {round.roundNumber}</span>
                <span className="round-group__count">{entries.length}</span>
                <span className="round-group__chevron">{collapsed ? '▼' : '▲'}</span>
            </button>

            {!collapsed && (
                <div className="round-group__entries">
                    {entries.length === 0 ? (
                        <p className="round-group__empty">No entries for this round.</p>
                    ) : (
                        entries.map((e) => (
                            <LogEntry
                                key={`${e.type}-${e.id}`}
                                entry={e}
                                timeZone={timeZone}
                                isNew={isEntryNew(e)}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
};
