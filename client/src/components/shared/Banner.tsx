import './Banner.css';

interface BannerProps {
  variant: 'success' | 'warning' | 'error' | 'info';
  message: string;
  dismissible?: boolean;
  onDismiss?: () => void;
}

export const Banner = ({ variant, message, dismissible = false, onDismiss }: BannerProps) => (
  <div className={`banner banner--${variant}`} role="alert">
    <span className="banner__message">{message}</span>
    {dismissible && (
      <button className="banner__dismiss" onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    )}
  </div>
);
