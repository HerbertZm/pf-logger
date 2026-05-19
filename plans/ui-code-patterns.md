# pf-logger — UI Code Patterns

Concrete implementations for the foundational pieces. Referenced from `ui-implementation.md`. Read the matching step there first for the "why" — this file is the "what."

---

## §1 — `main.tsx`

```tsx
// client/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { AuthProvider } from './context/AuthContext';
import { TournamentProvider } from './context/TournamentContext';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <TournamentProvider>
        <App />
      </TournamentProvider>
    </AuthProvider>
  </StrictMode>,
);
```

Provider nesting order matters: `AuthProvider` wraps `TournamentProvider` because `TournamentProvider` needs auth context to make authenticated API calls on mount.

---

## §2 — Shared primitive: `Badge`

The Badge pattern shows the full component + CSS approach used throughout.

```tsx
// client/src/components/shared/Badge.tsx
import './Badge.css';

type BadgeProps = {
  icon: string;
  label: string;
  variant: 'urgent' | 'warning' | 'success' | 'info' | 'muted' | 'penalty';
  disabled?: boolean;
};

export function Badge({ icon, label, variant, disabled = false }: BadgeProps) {
  return (
    <span
      className={`badge badge--${variant}${disabled ? ' badge--disabled' : ''}`}
      aria-label={label}
    >
      <span className="badge__icon" aria-hidden="true">{icon}</span>
      <span className="badge__label">{label}</span>
    </span>
  );
}
```

```css
/* client/src/components/shared/Badge.css */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);   /* always pill */
  border: 1.5px solid;
  font-size: var(--text-xs-size);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: default;
  user-select: none;
}

.badge--urgent  { background: var(--color-urgent-bg);  border-color: var(--color-urgent);  color: var(--color-urgent); }
.badge--warning { background: var(--color-warning-bg); border-color: var(--color-warning); color: var(--color-warning); }
.badge--success { background: var(--color-success-bg); border-color: var(--color-success); color: var(--color-success); }
.badge--info    { background: var(--color-info-bg);    border-color: var(--color-info);    color: var(--color-info); }
.badge--muted   { background: var(--color-muted-bg);   border-color: var(--color-muted);   color: var(--color-muted); }
.badge--penalty { background: var(--color-penalty-bg); border-color: var(--color-penalty); color: var(--color-penalty); }

.badge--disabled { opacity: 0.4; }
```

Follow this exact same pattern for `Button`, `Panel`, `Spinner`, `FilterChip` — co-located CSS file, `var(--token)` everywhere, BEM-style class names.

---

## §3 — API client

```typescript
// client/src/api/client.ts
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers ?? {}),
  };
  const res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(401, 'Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(url: string)                => apiFetch<T>(url),
  post:   <T>(url: string, body: unknown) => apiFetch<T>(url, { method: 'POST',   body: JSON.stringify(body) }),
  patch:  <T>(url: string, body: unknown) => apiFetch<T>(url, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: <T>(url: string)               => apiFetch<T>(url, { method: 'DELETE' }),
};
```

```typescript
// client/src/api/types.ts
export type Round = {
  id: number;
  tournamentId: number;
  roundNumber: number;
  timerDurationMinutes: number | null;  // null = Top-8; always null-check before any timer math
  startedAt: string | null;
  timerEndDatetime: string | null;      // UTC ISO; computed at ingestion; never use completed_at
  missingTablesJson: number[] | null;
  snapshotCapturedAt: string | null;
};

export type Drop = {
  id: number; tournamentId: number; roundId: number;
  playerName: string; tableNumber: number; loggedBy: string; loggedAt: string;
};

export type Extension = {
  id: number; tournamentId: number; roundId: number;
  tableNumber: number; playerName: string; durationMinutes: number;
  grantedBy: string; grantedAt: string;
};

export type Penalty = {
  id: number; roundId: number; playerName: string; infraction: string;
  remedy: string; tableNumber: number; loggedBy: string; loggedAt: string;
};

export type Coverage = {
  id: number; roundId: number; tableNumber: number; judgeId: string; arrivedAt: string;
};

export type JudgeCall = {
  id: number; roundId: number; tableNumber: number;
  judgeId: string; outcome: string; loggedAt: string;
};

export type Tournament = {
  id: number;
  name: string;
  shortName: string;
  cardeEventId: number | null;
  pfTournamentId: string | null;
  isActive: boolean;
  sources: { pf: boolean; carde: boolean };
};

export type WorkerStatus = {
  isRunning: boolean;
  lastSync: string | null;      // ISO UTC
  error: string | null;
  pfJwtExpiresAt: string | null;
};

export type ActiveRoundResponse = {
  round: Round;
  outstandingTables: number[];
  tablesWithExtensions: number[];
  extensions: Extension[];
  dropCount: number;
  penaltyCount: number;
  nowUtc: string;
};

export type LogEntry =
  | ({ type: 'drop' }       & Drop)
  | ({ type: 'extension' }  & Extension)
  | ({ type: 'penalty' }    & Penalty)
  | ({ type: 'coverage' }   & Coverage)
  | ({ type: 'judge_call' } & JudgeCall);

export type LogsResponse = { rounds: Round[]; entries: LogEntry[]; };

export type RoundSummary = {
  round: Round;
  dropCount: number;
  extensionCount: number;
  penaltyCount: number;
  outstandingAtTimeCalled: number;
  overtimeMinutes: number | null;
  extensions: Extension[];
};
```

---

## §4 — Context providers + hooks

### `AuthContext`

```tsx
// client/src/context/AuthContext.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../api/client';

type AuthState = {
  token: string | null;
  username: string | null;
  isAdmin: boolean;
  isSuperadmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken]           = useState<string | null>(() => localStorage.getItem('auth_token'));
  const [username, setUsername]     = useState<string | null>(null);
  const [isAdmin, setIsAdmin]       = useState(false);
  const [isSuperadmin, setSuperadmin] = useState(false);

  // Validate stored token on mount
  useEffect(() => {
    if (!token) return;
    api.get<{ username: string; role: string }>('/api/me')
      .then(me => {
        setUsername(me.username);
        setIsAdmin(me.role === 'admin' || me.role === 'superadmin');
        setSuperadmin(me.role === 'superadmin');
      })
      .catch(() => {
        localStorage.removeItem('auth_token');
        setToken(null);
      });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Clear state on 401 from anywhere in the app
  useEffect(() => {
    const onExpired = () => { setToken(null); setUsername(null); setIsAdmin(false); setSuperadmin(false); };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const login = async (u: string, p: string) => {
    const { token: t, username: name, role } =
      await api.post<{ token: string; username: string; role: string }>('/api/login', { username: u, password: p });
    localStorage.setItem('auth_token', t);
    setToken(t);
    setUsername(name);
    setIsAdmin(role === 'admin' || role === 'superadmin');
    setSuperadmin(role === 'superadmin');
  };

  const logout = async () => {
    await api.get('/api/logout').catch(() => {});
    localStorage.removeItem('auth_token');
    setToken(null); setUsername(null); setIsAdmin(false); setSuperadmin(false);
  };

  return (
    <AuthContext.Provider value={{ token, username, isAdmin, isSuperadmin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

### `TournamentContext`

```tsx
// client/src/context/TournamentContext.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../api/client';
import { Tournament } from '../api/types';

type TournamentState = {
  tournaments: Tournament[];
  activeTournamentId: number | null;
  activeTournament: Tournament | null;
  sources: { pf: boolean; carde: boolean };
  setActiveTournament: (id: number) => void;
};

const TournamentContext = createContext<TournamentState | null>(null);

export function TournamentProvider({ children }: { children: ReactNode }) {
  const [tournaments, setTournaments]       = useState<Tournament[]>([]);
  const [activeTournamentId, setActiveId]   = useState<number | null>(
    () => { const s = localStorage.getItem('active_tournament_id'); return s ? Number(s) : null; }
  );

  useEffect(() => {
    api.get<Tournament[]>('/api/tournaments').then(list => {
      setTournaments(list);
      // Auto-select most recent active if nothing persisted
      if (!activeTournamentId) {
        const active = list.find(t => t.isActive) ?? list[0] ?? null;
        if (active) setActiveId(active.id);
      }
    }).catch(() => {});
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const setActiveTournament = (id: number) => {
    localStorage.setItem('active_tournament_id', String(id));
    setActiveId(id);
  };

  const activeTournament = tournaments.find(t => t.id === activeTournamentId) ?? null;
  const sources = activeTournament?.sources ?? { pf: false, carde: false };

  return (
    <TournamentContext.Provider value={{ tournaments, activeTournamentId, activeTournament, sources, setActiveTournament }}>
      {children}
    </TournamentContext.Provider>
  );
}

export function useTournament() {
  const ctx = useContext(TournamentContext);
  if (!ctx) throw new Error('useTournament must be used within TournamentProvider');
  return ctx;
}
```

### `useWorkerStatus`

```typescript
// client/src/hooks/useWorkerStatus.ts
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { WorkerStatus } from '../api/types';

type WorkerState = {
  lastSync: Date | null;
  isRunning: boolean;
  error: string | null;
  isStale: boolean;
  pfJwtExpiresAt: Date | null;
};

export function useWorkerStatus(): WorkerState {
  const [state, setState] = useState<WorkerState>({
    lastSync: null, isRunning: false, error: null, isStale: false, pfJwtExpiresAt: null,
  });

  useEffect(() => {
    const fetch = () =>
      api.get<WorkerStatus>('/api/worker-status').then(s => {
        const lastSync = s.lastSync ? new Date(s.lastSync) : null;
        setState({
          lastSync,
          isRunning: s.isRunning,
          error: s.error,
          isStale: lastSync ? (Date.now() - lastSync.getTime()) > 120_000 : false,
          pfJwtExpiresAt: s.pfJwtExpiresAt ? new Date(s.pfJwtExpiresAt) : null,
        });
      }).catch(() => {});

    fetch();
    const id = setInterval(fetch, 10_000);
    return () => clearInterval(id);
  }, []);

  return state;
}
```

### `useRoundTimer`

```typescript
// client/src/hooks/useRoundTimer.ts
import { useEffect, useState } from 'react';
import { Round } from '../api/types';

type TimerState = {
  remaining: number;   // seconds; negative = overtime
  isOvertime: boolean;
  isTopEight: boolean;
  urgency: 'success' | 'warning' | 'urgent';
};

export function useRoundTimer(round: Round | null, outstandingCount: number): TimerState {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!round || round.timerDurationMinutes === null || !round.timerEndDatetime) {
      setRemaining(0);
      return;
    }
    const endMs = new Date(round.timerEndDatetime).getTime();
    const tick = () => setRemaining(Math.floor((endMs - Date.now()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [round?.id, round?.timerEndDatetime]);

  if (!round || round.timerDurationMinutes === null) {
    return { remaining: 0, isOvertime: false, isTopEight: true, urgency: 'success' };
  }

  const isOvertime = remaining <= 0;
  let urgency: TimerState['urgency'] = 'success';
  if (isOvertime || outstandingCount >= 5)      urgency = 'urgent';
  else if (remaining <= 300 || outstandingCount >= 1) urgency = 'warning';

  return { remaining, isOvertime, isTopEight: false, urgency };
}
```

---

## §5 — Polling pattern (data-fetching containers)

All screen containers (`ActiveRound`, `LogFeed`, `CrossRoundSummary`) follow this pattern:

```typescript
type State<T> = { data: T | null; loading: boolean; error: string | null };

function usePolling<T>(url: string, interval: number, enabled: boolean) {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null });

  useEffect(() => {
    if (!enabled) return;

    const fetch = () =>
      api.get<T>(url)
        .then(data => setState({ data, loading: false, error: null }))
        .catch(e  => setState(s => ({ ...s, loading: false, error: e.message })));

    fetch();
    const id = setInterval(fetch, interval);
    return () => clearInterval(id);
  }, [url, interval, enabled]);

  return state;
}
```

Usage example in `ActiveRound`:

```tsx
function ActiveRound() {
  const { activeTournamentId } = useTournament();
  const { data, loading, error } = usePolling<ActiveRoundResponse>(
    `/api/dashboard/active-round?tournamentId=${activeTournamentId}`,
    15_000,
    activeTournamentId !== null,
  );

  if (loading && !data) return <SkeletonPanel />;
  if (error)            return <Banner variant="error" message={error} />;
  if (!data?.round)     return <EmptyState message="No active round. Waiting for first sync." />;

  return (
    <>
      <RoundStrip round={data.round} urgency={...} />
      <RoundTimer round={data.round} outstandingCount={data.outstandingTables.length} onExtend={...} />
      <StatChips data={data} />
      <OutstandingTables tables={data.outstandingTables} withExtensions={data.tablesWithExtensions} />
      {data.extensions.length > 0 && <ExtensionsList extensions={data.extensions} />}
    </>
  );
}
```

---

## §6 — `formatTime` utility

Used by `RoundTimer` and any component displaying countdown values:

```typescript
// client/src/utils/time.ts
export function formatTime(seconds: number): string {
  const abs  = Math.abs(seconds);
  const mm   = String(Math.floor(abs / 60)).padStart(2, '0');
  const ss   = String(abs % 60).padStart(2, '0');
  return `${seconds < 0 ? '-' : ''}${mm}:${ss}`;
}

export function formatRelative(date: Date): string {
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}
```
