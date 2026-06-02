import { useState, useEffect } from 'react';
import './RoundGroup.css';
import { LogEntry } from './LogEntry';
import type { LogEntry as LogEntryType, Round } from '../../api/types';

interface RoundGroupProps {
    round: Round;
    entries: LogEntryType[];
}

const STORAGE_KEY = (id: number) => `round-group-collapsed-${id}`;

export const RoundGroup = ({ round, entries }: RoundGroupProps) => {
    const [collapsed, setCollapsed] = useState(() => {
        return localStorage.getItem(STORAGE_KEY(round.id)) === 'true';
    });

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY(round.id), String(collapsed));
    }, [collapsed, round.id]);

    return (
        <div className={`round-group ${collapsed ? 'round-group--collapsed' : 'round-group--expanded'}`}>
            <button className="round-group__header" onClick={() => setCollapsed((c) => !c)}>
                <span className="round-group__title">Round {round.roundNumber}</span>
                <span className="round-group__count">{entries.length}</span>
                <span className="round-group__chevron">{collapsed ? '▼' : '▲'}</span>
            </button>

            {!collapsed && (
                <div className="round-group__entries">
                    {entries.length === 0 ? (
                        <p className="round-group__empty">No entries for this round.</p>
                    ) : (
                        entries.map((e) => <LogEntry key={`${e.type}-${e.id}`} entry={e} />)
                    )}
                </div>
            )}
        </div>
    );
};
