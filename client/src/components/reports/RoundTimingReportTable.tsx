import './RoundTimingReportTable.css';
import type { RoundTimingReportRow } from '../../api/types';
import { ROUND_TIMING_COLUMNS } from './reportColumns';
import { formatReportCell } from './formatReportValue';

interface RoundTimingReportTableProps {
    rows: RoundTimingReportRow[];
    timeZone: string;
}

export const RoundTimingReportTable = ({ rows, timeZone }: RoundTimingReportTableProps) => (
    <div className="round-timing-report__table-wrap">
        <table className="round-timing-report__table">
            <thead>
                <tr>
                    {ROUND_TIMING_COLUMNS.map((col) => (
                        <th key={col.key} title={col.description}>
                            {col.label}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((row) => (
                    <tr key={row.roundNumber}>
                        {ROUND_TIMING_COLUMNS.map((col) => (
                            <td
                                key={col.key}
                                className={`round-timing-report__cell round-timing-report__cell--${col.kind}`}
                            >
                                {formatReportCell(row, col, timeZone)}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);
