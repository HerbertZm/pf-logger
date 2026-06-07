import { useCallback, useEffect, useRef, useState } from 'react';
import './CredentialsPanel.css';
import { api } from '../../api/client';
import type { CardeTokenStatus, PfJwtStatus } from '../../api/adminTypes';
import { Banner } from '../shared/Banner';
import { Button } from '../shared/Button';

function formatExpiry(iso: string | null): string {
    if (!iso) return 'unknown expiry';
    const d = new Date(iso);
    return d.toUTCString().replace(' GMT', ' UTC');
}

// ── PF JWT block ──────────────────────────────────────────────────────────────

const PfJwtBlock = () => {
    const [status, setStatus] = useState<PfJwtStatus | null>(null);
    const [jwtText, setJwtText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const load = useCallback((): void => {
        api.get<PfJwtStatus>('/api/session/pf-jwt')
            .then((s) => setStatus(s))
            .catch(() => setStatus(null));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const handleSet = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        const trimmed = jwtText.trim();
        if (!trimmed) return;
        setLoading(true);
        setError(null);
        setMessage(null);
        try {
            await api.post('/api/session/pf-jwt', { jwt: trimmed });
            setJwtText('');
            setMessage('PF JWT updated.');
            load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to set JWT');
        } finally {
            setLoading(false);
        }
    };

    const handleClear = (): void => {
        setError(null);
        setMessage(null);
        api.delete('/api/session/pf-jwt')
            .then(() => {
                setMessage('PF JWT cleared.');
                load();
            })
            .catch((err: Error) => setError(err.message));
    };

    const statusClass =
        status === null
            ? ''
            : status.status === 'valid' && status.inMemory
              ? 'creds-block__status--valid'
              : status.status === 'expired'
                ? 'creds-block__status--expired'
                : 'creds-block__status--missing';

    const statusText =
        status === null
            ? 'Loading…'
            : !status.inMemory && status.status === 'missing'
              ? 'Not set — paste below to enable PurpleFox features'
              : !status.inMemory
                ? `Not in memory · Last known: ${status.status}${status.expiresAt ? ` · Expired ${formatExpiry(status.expiresAt)}` : ''}`
                : status.status === 'expired'
                  ? `Expired · Set by ${status.setBy ?? 'unknown'} · Was valid until ${formatExpiry(status.expiresAt)}`
                  : `Valid in memory · Set by ${status.setBy ?? 'unknown'} · Expires ${formatExpiry(status.expiresAt)}`;

    return (
        <div className="creds-block">
            <h3 className="creds-block__title">PurpleFox JWT</h3>
            <p className={`creds-block__status ${statusClass}`}>{statusText}</p>
            {error !== null && <Banner variant="error" message={error} />}
            {message !== null && <Banner variant="success" message={message} />}
            <form className="manage-form" onSubmit={(e) => void handleSet(e)}>
                <label>
                    Paste JWT
                    <textarea
                        className="creds-jwt-input"
                        value={jwtText}
                        onChange={(e) => setJwtText(e.target.value)}
                        placeholder="eyJhbGci…"
                        spellCheck={false}
                        autoComplete="off"
                    />
                </label>
                <Button type="submit" variant="primary" loading={loading} disabled={!jwtText.trim()}>
                    Set JWT
                </Button>
                {status?.inMemory && (
                    <Button variant="danger" size="sm" onClick={handleClear}>
                        Clear
                    </Button>
                )}
            </form>
        </div>
    );
};

// ── Carde token block ─────────────────────────────────────────────────────────

const CardeTokenBlock = () => {
    const [status, setStatus] = useState<CardeTokenStatus | null>(null);
    const [tokenText, setTokenText] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const load = useCallback((): void => {
        api.get<CardeTokenStatus>('/api/session/carde-token')
            .then((s) => setStatus(s))
            .catch(() => setStatus(null));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const handleSet = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        const trimmed = tokenText.trim();
        if (!trimmed) return;
        setLoading(true);
        setError(null);
        setMessage(null);
        try {
            await api.post('/api/session/carde-token', { token: trimmed });
            setTokenText('');
            setMessage('Carde token override set.');
            load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to set token');
        } finally {
            setLoading(false);
        }
    };

    const handleClear = (): void => {
        setError(null);
        setMessage(null);
        api.delete('/api/session/carde-token')
            .then(() => {
                setMessage('Carde token override cleared — reverting to env var.');
                load();
            })
            .catch((err: Error) => setError(err.message));
    };

    const statusClass =
        status === null
            ? ''
            : status.source === 'memory'
              ? 'creds-block__status--memory'
              : status.hasToken
                ? 'creds-block__status--env'
                : 'creds-block__status--missing';

    const statusText =
        status === null
            ? 'Loading…'
            : status.source === 'memory'
              ? `Memory override active · Set by ${status.setBy ?? 'unknown'} · ${status.setAt ? formatExpiry(status.setAt) : ''}`
              : status.hasToken
                ? 'Using CARDE_API_TOKEN env var'
                : 'No token — set CARDE_API_TOKEN in .env or paste an override below';

    return (
        <div className="creds-block">
            <h3 className="creds-block__title">Carde.io API token</h3>
            <p className={`creds-block__status ${statusClass}`}>{statusText}</p>
            {error !== null && <Banner variant="error" message={error} />}
            {message !== null && <Banner variant="success" message={message} />}
            <form className="manage-form" onSubmit={(e) => void handleSet(e)}>
                <label>
                    Token override
                    <input
                        ref={inputRef}
                        className="creds-token-input"
                        type={showToken ? 'text' : 'password'}
                        value={tokenText}
                        onChange={(e) => setTokenText(e.target.value)}
                        placeholder="Paste token…"
                        autoComplete="off"
                        spellCheck={false}
                    />
                </label>
                <Button type="submit" variant="primary" loading={loading} disabled={!tokenText.trim()}>
                    Set token
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setShowToken((v) => !v)}>
                    {showToken ? 'Hide' : 'Show'}
                </Button>
                {status?.source === 'memory' && (
                    <Button variant="danger" size="sm" onClick={handleClear}>
                        Clear override
                    </Button>
                )}
            </form>
        </div>
    );
};

// ── Panel ─────────────────────────────────────────────────────────────────────

export const CredentialsPanel = () => {
    return (
        <section>
            <h2 className="manage-section__title">Service credentials</h2>
            <PfJwtBlock />
            <CardeTokenBlock />
        </section>
    );
};
