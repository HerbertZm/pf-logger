import './ExtensionHistogram.css';
import type { Extension } from '../../api/types';

interface ExtensionHistogramProps {
  extensions: Extension[];
}

export const ExtensionHistogram = ({ extensions }: ExtensionHistogramProps) => {
  if (extensions.length === 0) return null;

  // Bucket by extension_minutes in 5-min increments
  const buckets: Record<number, number> = {};
  extensions.forEach((e) => {
    const mins = e.extensionMinutes ?? 0;
    const bucket = Math.ceil(mins / 5) * 5;
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
  });

  const entries = Object.entries(buckets)
    .map(([k, v]) => ({ label: `${k}m`, count: v }))
    .sort((a, b) => parseInt(a.label) - parseInt(b.label));

  const max = Math.max(...entries.map((e) => e.count));

  return (
    <div className="ext-histogram">
      <p className="ext-histogram__title">Extension distribution</p>
      <div className="ext-histogram__bars">
        {entries.map(({ label, count }) => (
          <div key={label} className="ext-histogram__col">
            <span className="ext-histogram__count">{count}</span>
            <div
              className="ext-histogram__bar"
              style={{ height: `${Math.round((count / max) * 48)}px` }}
            />
            <span className="ext-histogram__label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
