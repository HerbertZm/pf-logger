import './ExtensionHistogram.css';
import type { Extension } from '../../api/types';
import { splitExtensions } from '../../utils/extensions';

interface ExtensionHistogramProps {
    extensions: Extension[];
    logisticsThresholdMin: number;
}

export const ExtensionHistogram = ({ extensions, logisticsThresholdMin }: ExtensionHistogramProps) => {
    const { operational, logistics } = splitExtensions(extensions, logisticsThresholdMin);
    if (operational.length === 0 && logistics.length === 0) return null;
    if (operational.length < 2) return null;

    // Bucket by extension_minutes in 5-min increments (operational only)
    const buckets: Record<number, number> = {};
    operational.forEach((e) => {
        const mins = e.extensionMinutes ?? 0;
        const bucket = Math.ceil(mins / 5) * 5;
        buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    });

    const entries = Object.entries(buckets)
        .map(([k, v]) => ({ label: `${k}m`, count: v }))
        .sort((a, b) => parseInt(a.label, 10) - parseInt(b.label, 10));

    if (entries.length === 0) {
        return (
            <p className="ext-histogram__logistics-only">
                {logistics.length} extension(s) ≥{logisticsThresholdMin}m excluded as logistics
            </p>
        );
    }

    const max = Math.max(...entries.map((e) => e.count));

    return (
        <div className="ext-histogram">
            <p className="ext-histogram__title">Extensions by duration granted</p>
            {logistics.length > 0 && (
                <p className="ext-histogram__logistics-note">
                    {logistics.length} extension(s) ≥{logisticsThresholdMin}m excluded (logistics)
                </p>
            )}
            <div className="ext-histogram__bars">
                {entries.map(({ label, count }) => (
                    <div key={label} className="ext-histogram__col">
                        <span className="ext-histogram__count">{count}</span>
                        <div className="ext-histogram__bar" style={{ height: `${Math.round((count / max) * 48)}px` }} />
                        <span className="ext-histogram__label">{label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
