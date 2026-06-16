import { useState } from 'react';
import './OutstandingTables.css';

interface OutstandingTablesProps {
    tables: number[];
    withExtensions: number[];
    extensionTotals: Map<number, number>;
}

export const OutstandingTables = ({ tables, withExtensions, extensionTotals }: OutstandingTablesProps) => {
    const [expanded, setExpanded] = useState(true);
    const extSet = new Set(withExtensions);

    if (tables.length === 0) return null;

    return (
        <div className="outstanding">
            <button className="outstanding__header" onClick={() => setExpanded((e) => !e)}>
                <span className="outstanding__title">Outstanding Tables ({tables.length})</span>
                <span className="outstanding__chevron">{expanded ? '▲' : '▼'}</span>
            </button>

            {expanded && (
                <div className="outstanding__grid">
                    {tables.map((t) => {
                        const totalExt = extensionTotals.get(t);
                        return (
                            <span
                                key={t}
                                className={`outstanding__table${extSet.has(t) ? ' outstanding__table--ext' : ''}`}
                                title={extSet.has(t) ? 'Has extension' : undefined}
                            >
                                {t}
                                {totalExt !== undefined && totalExt > 0 && (
                                    <span className="outstanding__ext-total">+{totalExt}m</span>
                                )}
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
