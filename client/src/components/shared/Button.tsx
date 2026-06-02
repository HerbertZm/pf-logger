import './Button.css';
import { Spinner } from './Spinner';

interface ButtonProps {
    children: React.ReactNode;
    variant: 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
    size?: 'sm' | 'md';
    loading?: boolean;
    disabled?: boolean;
    onClick?: () => void;
    type?: 'button' | 'submit';
}

export const Button = ({
    children,
    variant,
    size = 'md',
    loading = false,
    disabled = false,
    onClick,
    type = 'button',
}: ButtonProps) => (
    <button type={type} className={`btn btn--${variant} btn--${size}`} disabled={disabled || loading} onClick={onClick}>
        {loading && <Spinner size="sm" />}
        {children}
    </button>
);
