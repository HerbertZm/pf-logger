import { useState } from 'react';
import './LoginModal.css';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../shared/Button';

export const LoginModal = () => {
    const { login } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await login(username, password);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-scrim">
            <form
                className="login-modal"
                onSubmit={(e) => {
                    void handleSubmit(e);
                }}
                noValidate
            >
                <h1 className="login-modal__title">pf-logger</h1>
                <p className="login-modal__sub">Tournament operations dashboard</p>

                <div className="login-modal__fields">
                    <input
                        autoFocus
                        className="login-modal__input"
                        type="text"
                        placeholder="Username"
                        autoComplete="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                    <input
                        className="login-modal__input"
                        type="password"
                        placeholder="Password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>

                {error && <p className="login-modal__error">{error}</p>}

                <Button type="submit" variant="primary" loading={loading}>
                    Sign in
                </Button>
            </form>
        </div>
    );
};
