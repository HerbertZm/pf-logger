import { useMemo, useState } from 'react';
import './RoundComparePanel.css';
import type { RoundSummary } from '../../api/types';
import { operationalExtensionCount } from '../../utils/extensions';

interface RoundComparePanelProps {
    summaries: RoundSummary[];
    logisticsThresholdMin: number;
    showPf: boolean;
}

interface CompareRow {
    label: string;
    a: string;
    b: string;
    delta: string;
    deltaTone: '' | 'up' | 'down' | 'same';
}

function fmt(n: number | null): string {
    return n === null || n === 0 ? '—' : String(n);
}

function deltaNum(a: number, b: number): { text: string; tone: CompareRow['deltaTone'] } {
    const d = b - a;
    if (d === 0) return { text: '—', tone: 'same' };
    const arrow = d > 0 ? '▲' : '▼';
    return { text: `${arrow} ${Math.abs(d)}`, tone: d > 0 ? 'up' : 'down' };
}

export const RoundComparePanel = ({ summaries, logisticsThresholdMin, showPf }: RoundComparePanelProps) => {
    const roundNumbers = useMemo(() => summaries.map((s) => s.round.roundNumber).sort((x, y) => x - y), [summaries]);
    const [roundA, setRoundA] = useState<number | ''>('');
    const [roundB, setRoundB] = useState<number | ''>('');

    const summaryA = summaries.find((s) => s.round.roundNumber === roundA);
    const summaryB = summaries.find((s) => s.round.roundNumber === roundB);

    const rows: CompareRow[] = useMemo(() => {
        if (summaries.length < 2 || summaryA === undefined || summaryB === undefined) return [];
        const extA = operationalExtensionCount(summaryA.extensions, logisticsThresholdMin);
        const extB = operationalExtensionCount(summaryB.extensions, logisticsThresholdMin);
        const out: CompareRow[] = [];
        if (showPf) {
            const d = deltaNum(summaryA.dropCount, summaryB.dropCount);
            out.push({
                label: 'Drops',
                a: fmt(summaryA.dropCount),
                b: fmt(summaryB.dropCount),
                delta: d.text,
                deltaTone: d.tone,
            });
        }
        {
            const d = deltaNum(extA, extB);
            out.push({
                label: 'Extensions (ops)',
                a: fmt(extA),
                b: fmt(extB),
                delta: d.text,
                deltaTone: d.tone,
            });
        }
        {
            const d = deltaNum(summaryA.penaltyCount, summaryB.penaltyCount);
            out.push({
                label: 'Penalties',
                a: fmt(summaryA.penaltyCount),
                b: fmt(summaryB.penaltyCount),
                delta: d.text,
                deltaTone: d.tone,
            });
        }
        {
            const d = deltaNum(summaryA.outstandingAtTimeCalled, summaryB.outstandingAtTimeCalled);
            out.push({
                label: 'Late tables',
                a: fmt(summaryA.outstandingAtTimeCalled),
                b: fmt(summaryB.outstandingAtTimeCalled),
                delta: d.text,
                deltaTone: d.tone,
            });
        }
        out.push({
            label: 'Overtime (min)',
            a: summaryA.overtimeMinutes !== null ? `${summaryA.overtimeMinutes}` : 'n/a',
            b: summaryB.overtimeMinutes !== null ? `${summaryB.overtimeMinutes}` : 'n/a',
            delta: '—',
            deltaTone: 'same',
        });
        return out;
    }, [summaries.length, summaryA, summaryB, logisticsThresholdMin, showPf]);

    if (summaries.length < 2) return null;

    return (
        <section className="round-compare">
            <h3 className="round-compare__title">Compare rounds</h3>
            <div className="round-compare__pickers">
                <label>
                    Round A
                    <select
                        value={roundA}
                        onChange={(e) => setRoundA(e.target.value === '' ? '' : Number(e.target.value))}
                    >
                        <option value="">Select…</option>
                        {roundNumbers.map((n) => (
                            <option key={n} value={n}>
                                {n}
                            </option>
                        ))}
                    </select>
                </label>
                <label>
                    Round B
                    <select
                        value={roundB}
                        onChange={(e) => setRoundB(e.target.value === '' ? '' : Number(e.target.value))}
                    >
                        <option value="">Select…</option>
                        {roundNumbers.map((n) => (
                            <option key={n} value={n}>
                                {n}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            {rows.length > 0 && (
                <table className="round-compare__table">
                    <thead>
                        <tr>
                            <th>Metric</th>
                            <th>Rd {roundA}</th>
                            <th>Rd {roundB}</th>
                            <th>Δ (B − A)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.label}>
                                <td>{row.label}</td>
                                <td>{row.a}</td>
                                <td>{row.b}</td>
                                <td className={row.deltaTone ? `round-compare__delta--${row.deltaTone}` : ''}>
                                    {row.delta}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
};
