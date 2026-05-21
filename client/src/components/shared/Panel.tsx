import './Panel.css';

interface PanelProps {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'urgent' | 'warning' | 'success' | 'pending';
  glow?: boolean;
  accentBar?: boolean;
  className?: string;
}

export const Panel = ({
  children,
  variant = 'default',
  glow = false,
  accentBar = false,
  className = '',
}: PanelProps) => (
  <div
    className={[
      'panel',
      `panel--${variant}`,
      glow ? 'panel--glow' : '',
      accentBar ? 'panel--accent' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </div>
);
