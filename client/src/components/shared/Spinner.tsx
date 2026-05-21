import './Spinner.css';

interface SpinnerProps {
  size?: 'sm' | 'md';
}

export const Spinner = ({ size = 'md' }: SpinnerProps) => (
  <span className={`spinner spinner--${size}`} role="status" aria-label="Loading" />
);
