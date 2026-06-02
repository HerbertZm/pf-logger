import './Badge.css';

interface BadgeProps {
  icon: string;
  label: string;
  variant: 'urgent' | 'warning' | 'success' | 'info' | 'muted' | 'penalty';
  disabled?: boolean;
}

export const Badge = ({ icon, label, variant, disabled = false }: BadgeProps) => (
  <span
    className={`badge badge--${variant}${disabled ? ' badge--disabled' : ''}`}
    aria-label={label}
  >
    <span className="badge__icon" aria-hidden="true">
      {icon}
    </span>
    <span className="badge__label">{label}</span>
  </span>
);
