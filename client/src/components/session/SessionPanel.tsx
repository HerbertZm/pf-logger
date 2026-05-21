import { useState } from 'react';
import './SessionPanel.css';
import { api } from '../../api/client';
import { useTournament } from '../../context/TournamentContext';
import { useWorkerStatus } from '../../hooks/useWorkerStatus';
import { Button } from '../shared/Button';
import { Banner } from '../shared/Banner';

export const SessionPanel = () => {
  const { activeTournament, sources } = useTournament();
  // useWorkerStatus for pfJwtExpiresAt — JWT is global but expiry is surfaced per tournament poll
  const { pfJwtExpiresAt } = useWorkerStatus(activeTournament?.id ?? null);
  const [jwt, setJwt] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [devToolsOpen, setDevToolsOpen] = useState(false);

  if (!sources.pf) {
    return (
      <div className="session-panel__unavailable">
        Session management is not available for Carde-only tournaments.
      </div>
    );
  }

  const expiryStatus = () => {
    if (!pfJwtExpiresAt) return null;
    const minsLeft = (pfJwtExpiresAt.getTime() - Date.now()) / 60_000;
    if (minsLeft < 0) return { label: 'Expired', cls: 'session-panel__expiry--error' };
    if (minsLeft < 30) return { label: `Expires in ${Math.floor(minsLeft)}m`, cls: 'session-panel__expiry--warn' };
    return { label: `Expires in ${Math.floor(minsLeft)}m`, cls: 'session-panel__expiry--ok' };
  };

  const expiry = expiryStatus();

  const handleSave = async () => {
    if (!jwt.trim()) return;
    setSaving(true);
    setResult(null);
    try {
      // POST global JWT — not per-tournament; one JWT credential serves all PF tournaments
      await api.post('/api/session/pf-jwt', { token: jwt.trim() });
      setResult({ ok: true, msg: 'Token saved. Worker will use it on next cycle.' });
      setJwt('');
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="session-panel">
      <div className="session-panel__card">
        <h2 className="session-panel__heading">PurpleFox JWT</h2>

        <div className="session-panel__status-row">
          <span className="session-panel__status-label">Current token status:</span>
          {expiry ? (
            <span className={expiry.cls}>{expiry.label}</span>
          ) : (
            <span className="session-panel__expiry--none">No token stored</span>
          )}
        </div>

        <textarea
          className="session-panel__textarea"
          placeholder="Paste JWT from browser DevTools…"
          value={jwt}
          onChange={(e) => setJwt(e.target.value)}
          rows={4}
          spellCheck={false}
        />

        {result && (
          <Banner
            variant={result.ok ? 'success' : 'error'}
            message={result.msg}
            dismissible
            onDismiss={() => setResult(null)}
          />
        )}

        <div className="session-panel__actions">
          <Button variant="primary" loading={saving} disabled={!jwt.trim()} onClick={handleSave}>
            Save token
          </Button>
          {jwt && (
            <Button variant="ghost" size="sm" onClick={() => setJwt('')}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="session-panel__devtools">
        <button
          className="session-panel__devtools-toggle"
          onClick={() => setDevToolsOpen((o) => !o)}
        >
          {devToolsOpen ? '▲' : '▼'} How to get the JWT from DevTools
        </button>
        {devToolsOpen && (
          <ol className="session-panel__devtools-steps">
            <li>Open <strong>purplefox.gg</strong> and log in</li>
            <li>Open DevTools → Application → Local Storage → <code>https://purplefox.gg</code></li>
            <li>Find the key <code>sb-…-auth-token</code> and copy the <code>access_token</code> value</li>
            <li>Paste it above and click Save</li>
          </ol>
        )}
      </div>
    </div>
  );
};
