import './RoundTimingColumnGuide.css';
import { ROUND_TIMING_COLUMNS } from './reportColumns';

export const RoundTimingColumnGuide = () => (
    <section className="round-timing-column-guide" aria-labelledby="round-timing-column-guide-title">
        <h2 id="round-timing-column-guide-title" className="round-timing-column-guide__title">
            Column reference
        </h2>
        <table className="round-timing-column-guide__table">
            <thead>
                <tr>
                    <th scope="col">Column</th>
                    <th scope="col">Description</th>
                </tr>
            </thead>
            <tbody>
                {ROUND_TIMING_COLUMNS.map((col) => (
                    <tr key={col.key}>
                        <th scope="row" className="round-timing-column-guide__col-name">
                            {col.label}
                        </th>
                        <td className="round-timing-column-guide__col-desc">{col.description}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </section>
);
