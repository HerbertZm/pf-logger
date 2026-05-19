# pf-logger — UI Implementation Plan

**Goal:** Replace the vanilla JS / Python prototype (`index.html` + `serve.py`) with a React 18 + Vite frontend backed by the TypeScript + Express + PostgreSQL stack built in Phase 0.

**Design reference:** Figma file at https://www.figma.com/design/czEoZNIW8dHjbiea6OwlOi  
**Design tokens:** `client/src/styles/tokens.css` (complete, checked in)  
**Design spec:** `docs/design-spec.md`

---

## Current state (as of design phase)

| File | What it is |
|---|---|
| `serve.py` | Python 3 HTTP server, SQLite backend, port 8765. All routes in one file. |
| `index.html` | 2,575-line vanilla JS monolith. IBM Plex fonts, purple accent, no round-timer view. |
| `action_logs.db` | SQLite database — drops, extensions, penalties, coverage, judge calls, rounds, sessions. |
| `client/src/styles/tokens.css` | CSS custom properties — complete design system, ready to use. |
| `docs/design-spec.md` | Full screen and component spec from design session. |

The new UI is not a reskin of the existing one — it's a rewrite with a new primary view (active round / timer). The existing tabs map roughly as:

| Old tab | New tab | Notes |
|---|---|---|
| Logs | Logs | Redesigned; now grouped + filterable with all log types |
| Session | Session | Ported — same functionality |
| Data | Data | Ported — raw table explorer |
| Tools | Manage → Tournament panel | Backfill, end-tournament move here under P1 |
| Activity | Manage → Audit log | Under P1 |
| API Reference | Removed | Dev-only; move to `docs/` |
| *(none)* | **Dashboard** | New — active round timer + outstanding tables |
| *(none)* | **Insights** | New — cross-round summary table |
| *(none)* | **Manage** | New — P1, superadmin only |

---

## Prerequisites

These P0 steps must be complete before any React component can render live data:

- **P0.2** — Project bootstrap (Vite scaffold, root scripts, ESLint, tsconfig)
- **P0.3** — Schema live in PostgreSQL (rounds, matches, drops, extensions, penalties, coverage, judge_calls)
- **P0.4** — Background ingestion worker running (Carde + PF polling)
- **P0.5** — All HTTP API routes ported to TypeScript + Express + Prisma

The React frontend can be scaffolded (P0.2) and the design system + primitives can be built (steps 1–2 below) before the backend is fully wired. Components can render with mock data during that phase.

---

## Build order overview

```
Step 0  Bootstrap (P0.2)
Step 1  Design system foundation
Step 2  Shared primitives
Step 3  API client + types
Step 4  Context providers + hooks
Step 5  Layout shell
Step 6  Auth flow
Step 7  Dashboard — Active Round (Screen 1)
Step 8  Logs Feed (Screen 3)
Step 9  Insights — Cross-Round Summary (Screen 2)
Step 10 Session tab
Step 11 Data tab (raw explorer)
Step 12 Manage tab — P1 (Screen 4)
```

---

## Step 0 — Project Bootstrap (P0.2)

**Prerequisite for everything. Do this first.**

### 0.1 — Scaffold the client

```bash
npm create vite@latest client -- --template react-ts
cd client && npm install
```

Remove the Vite boilerplate (`App.css`, `assets/`, contents of `App.tsx`, `index.css`).

### 0.2 — Root `package.json`

Create a root-level `package.json` that orchestrates both the Express API and the Vite dev server:

```json
{
  "scripts": {
    "dev":       "concurrently \"ts-node-dev --respawn src/server.ts\" \"vite --root client\"",
    "build":     "tsc -p tsconfig.build.json && vite build --root client",
    "start":     "node dist/server.js",
    "typecheck": "tsc --noEmit && tsc --noEmit -p client/tsconfig.json",
    "lint":      "eslint src client/src --ext .ts,.tsx"
  }
}
```

### 0.3 — Vite config (`client/vite.config.ts`)

Proxy all `/api/*` requests to Express so the React dev server and backend run independently:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT ?? 8080}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist/client',
  },
});
```

### 0.4 — TypeScript configs

`tsconfig.json` (root, backend):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

`client/tsconfig.json` (frontend):
```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "noEmit": true,
    "rootDir": "src",
    "baseUrl": "src"
  },
  "include": ["src"]
}
```

### 0.5 — ESLint + Prettier

Install: `npm i -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-plugin-react-hooks prettier eslint-config-prettier`

Minimal `.eslintrc.json`:
```json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
  }
}
```

`.prettierrc`: `{ "semi": true, "singleQuote": true, "trailingComma": "all" }`

---

## Step 1 — Design System Foundation

`tokens.css` is already written and checked in. This step completes the CSS layer.

### 1.1 — `client/src/styles/global.css`

Imports `tokens.css` and adds base styles that apply globally. Nothing component-specific here:

```css
@import './tokens.css';

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-family: var(--font-sans);
  font-size: var(--text-base-size);
  line-height: var(--text-base-line);
  color: var(--color-text-primary);
  background-color: var(--color-bg-base);
  -webkit-font-smoothing: antialiased;
}

body { overflow-x: hidden; }

:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* Overtime flash — applied to .timer-overtime class via JS */
@keyframes overtime-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}

.timer-overtime {
  animation: overtime-pulse 1s ease-in-out infinite;
}
```

### 1.2 — Component CSS architecture

Each component gets a co-located `.css` file. No CSS-in-JS, no Tailwind. All values come from `var(--token-name)`:

```
components/
  shared/
    Badge.tsx
    Badge.css       ← co-located, imports nothing (tokens available globally)
    Button.tsx
    Button.css
    ...
```

Import global CSS in `client/src/main.tsx`:
```typescript
import './styles/global.css';
```

All component CSS is imported directly in the component file:
```typescript
// Badge.tsx
import './Badge.css';
```

---

## Step 2 — Shared Primitives

Build these first — everything else depends on them. All are stateless, driven purely by props. No data fetching here.

### 2.1 — `Badge`

**Props:**
```typescript
type BadgeProps = {
  icon: string;          // unicode glyph: '↓', '+', '!', '◈', '⚖', '✓', '◐', '⚠', '●', '★', '◆', '◇'
  label: string;         // UPPERCASE label e.g. 'DROP'
  variant: 'urgent' | 'warning' | 'success' | 'info' | 'muted' | 'penalty';
  disabled?: boolean;
};
```

**Visual spec:**
- Shape: pill (`border-radius: 9999px`)
- Height: 28px, padding: 0 8px
- Font: 11px Bold, UPPERCASE
- Background: `var(--color-{variant}-bg)`
- Text + border: `var(--color-{variant})`
- Border: 1.5px solid
- Disabled: `opacity: 0.4`

**Variants map:**

| variant | hex token | Use case |
|---|---|---|
| urgent | `--color-urgent` | DROP, ⚠ URGENT |
| warning | `--color-warning` | EXT, ◐ WATCH |
| penalty | `--color-penalty` | PEN |
| info | `--color-info` | COVERAGE, JUDGE CALL, source badges |
| success | `--color-success` | ✓ ON TRACK, ● LIVE |
| muted | `--color-muted` | ENDED, CARDE ONLY |

**Never use Badge as a clickable element.** Badges are purely informational.

### 2.2 — `Button`

**Props:**
```typescript
type ButtonProps = {
  children: React.ReactNode;
  variant: 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
  size?: 'sm' | 'md';      // default: 'md'
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
};
```

**Visual spec:**
- Shape: rounded rect (`border-radius: 8px`) — NEVER pill-shaped
- Height: 44px (`md`), 32px (`sm`)
- Padding: `0 var(--space-5)` (md), `0 var(--space-4)` (sm)
- Font: 14px Medium, Sentence case
- Min-width: 120px (md), 80px (sm)
- Loading state: show `<Spinner />` inline, disable pointer events

| variant | background | text | border |
|---|---|---|---|
| primary | `--color-info` | `#FFFFFF` | none |
| secondary | `--color-bg-elevated` | `--color-text-secondary` | `--color-border-default` |
| danger | `--color-urgent-bg` | `--color-urgent` | `--color-urgent` |
| warning | `--color-warning-bg` | `--color-warning` | `--color-warning` |
| ghost | transparent | `--color-text-secondary` | `--color-border-subtle` |

### 2.3 — `Panel`

**Props:**
```typescript
type PanelProps = {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'urgent' | 'warning';
  glow?: boolean;       // adds box-shadow glow matching variant color
  accentBar?: boolean;  // adds 3px left accent bar in variant color
  className?: string;
};
```

**Spec:** `border-radius: var(--radius-lg)`, `padding: var(--panel-padding)`. Glow uses `--glow-urgent` / `--glow-warning` / `--glow-success` tokens. Accent bar is `position: absolute; left: 0; top: 0; bottom: 0; width: 3px`.

### 2.4 — `Badge` (status badge — reuse above)

No separate component needed. The single `Badge` component handles all badge types via `variant` + `icon` + `label` props.

### 2.5 — `Spinner`

```typescript
type SpinnerProps = { size?: 'sm' | 'md'; };
```

Simple CSS `@keyframes spin` border animation. 10px (sm), 16px (md). Color: `--color-info`.

### 2.6 — `Toast` / `Banner`

**Props:**
```typescript
type BannerProps = {
  variant: 'success' | 'warning' | 'error' | 'info';
  message: string;
  dismissible?: boolean;
  onDismiss?: () => void;
};
```

**Spec:** Left accent bar (3px, variant color). Height: 36px. Background: `var(--color-{variant}-bg)`. Full-width, stacks below ContextBar. Managed by a `ToastContext` or a simple `useBanner` hook that the worker status hook drives automatically.

### 2.7 — `FilterChip`

**Props:**
```typescript
type FilterChipProps = {
  label: string;
  active: boolean;
  pfOnly?: boolean;    // shows 'PF' superscript, hidden in Carde-only mode
  onClick: () => void;
};
```

**Spec:** Pill shape (`border-radius: 9999px`), height 36px, padding `0 var(--space-4)`. Active: `background: var(--color-info); border-color: var(--color-info); color: #fff`. Inactive: `background: var(--color-bg-elevated); border: 1.5px solid var(--color-border-default); color: var(--color-text-secondary)`. `pfOnly` badge: 8px "PF" superscript on top-right corner in info color.

---

## Step 3 — API Client + Types

### 3.1 — `client/src/api/client.ts`

Central fetch wrapper. Mirrors the existing `apiFetch()` but typed:

```typescript
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function apiFetch<T>(
  url: string,
  opts: RequestInit = {}
): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...opts.headers,
  };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    localStorage.removeItem('auth_token');
    window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(401, 'Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(url: string)                   => apiFetch<T>(url),
  post:   <T>(url: string, body: unknown)    => apiFetch<T>(url, { method: 'POST',  body: JSON.stringify(body) }),
  patch:  <T>(url: string, body: unknown)    => apiFetch<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(url: string)                   => apiFetch<T>(url, { method: 'DELETE' }),
};
```

### 3.2 — `client/src/api/types.ts`

Shared response types. Mirror the Prisma schema output — keep in sync as the schema evolves:

```typescript
// Core entities
export type Round = {
  id: number;
  tournamentId: number;
  roundNumber: number;
  timerDurationMinutes: number | null;  // null for Top-8
  startedAt: string | null;             // ISO UTC
  timerEndDatetime: string | null;      // ISO UTC — computed locally at ingestion
  missingTablesJson: number[] | null;   // snapshot at time-called
  snapshotCapturedAt: string | null;
};

export type Drop = {
  id: number;
  tournamentId: number;
  roundId: number;
  playerName: string;
  tableNumber: number;
  loggedBy: string;     // PF staff username
  loggedAt: string;
};

export type Extension = {
  id: number;
  tournamentId: number;
  roundId: number;
  tableNumber: number;
  playerName: string;
  durationMinutes: number;
  grantedBy: string;
  grantedAt: string;
};

export type Penalty = {
  id: number;
  roundId: number;
  playerName: string;
  infraction: string;
  remedy: string;
  tableNumber: number;
  loggedBy: string;
  loggedAt: string;
};

export type Coverage = {
  id: number;
  roundId: number;
  tableNumber: number;
  judgeId: string;
  arrivedAt: string;
};

export type JudgeCall = {
  id: number;
  roundId: number;
  tableNumber: number;
  judgeId: string;
  outcome: string;
  loggedAt: string;
};

export type Tournament = {
  id: number;
  name: string;
  shortName: string;
  cardeEventId: number | null;
  pfTournamentId: string | null;
  isActive: boolean;
  sources: { pf: boolean; carde: boolean; };
};

export type WorkerStatus = {
  isRunning: boolean;
  lastSync: string | null;    // ISO UTC
  error: string | null;
  pfJwtExpiresAt: string | null;
};

// Dashboard API response
export type ActiveRoundResponse = {
  round: Round;
  outstandingTables: number[];
  tablesWithExtensions: number[];
  extensions: Extension[];
  dropCount: number;
  penaltyCount: number;
  nowUtc: string;
};

// Logs API response
export type LogEntry =
  | ({ type: 'drop' }      & Drop)
  | ({ type: 'extension' } & Extension)
  | ({ type: 'penalty' }   & Penalty)
  | ({ type: 'coverage' }  & Coverage)
  | ({ type: 'judge_call' } & JudgeCall);

export type LogsResponse = {
  rounds: Round[];
  entries: LogEntry[];    // all types, sorted by loggedAt desc
};

// Cross-round summary
export type RoundSummary = {
  round: Round;
  dropCount: number;
  extensionCount: number;
  penaltyCount: number;
  outstandingAtTimeCalled: number;
  overtimeMinutes: number | null;
  extensions: Extension[];  // for histogram
};
```

---

## Step 4 — Context Providers + Hooks

### 4.1 — `AuthContext`

```
client/src/context/AuthContext.tsx
client/src/hooks/useAuth.ts        → re-export of useContext(AuthContext)
```

State: `{ token: string | null; username: string | null; isAdmin: boolean; isSuperadmin: boolean; }`

Actions: `login(username, password)` → POST `/api/login`, store token in `localStorage`. `logout()` → GET `/api/logout`, clear `localStorage`.

On mount: if token in `localStorage`, GET `/api/me` to verify. On `auth:expired` event: clear state + show login modal.

### 4.2 — `TournamentContext`

```
client/src/context/TournamentContext.tsx
client/src/hooks/useTournament.ts
```

State:
```typescript
{
  tournaments: Tournament[];
  activeTournamentId: number | null;
  activeTournament: Tournament | null;
  sources: { pf: boolean; carde: boolean; };   // derived from activeTournament
  setActiveTournament: (id: number) => void;
}
```

On mount: GET `/api/tournaments`, auto-select most recent active tournament. Persist selection in `localStorage` so it survives refresh.

`sources` is derived directly: `activeTournament?.sources ?? { pf: false, carde: false }`.

**This is the single source of truth for all source-conditional rendering.** Components read `useTournament().sources.pf` — no other mechanism.

### 4.3 — `useWorkerStatus`

```
client/src/hooks/useWorkerStatus.ts
```

Polls `GET /api/worker-status` every 10 seconds. Returns:
```typescript
{ lastSync: Date | null; isRunning: boolean; error: string | null; isStale: boolean; pfJwtExpiresAt: Date | null; }
```

`isStale = lastSync !== null && (Date.now() - lastSync.getTime()) > 2 * 60 * 1000` (> 2 minutes).

In P2, replace polling with SSE subscription. The hook interface stays the same — only the internal mechanism changes.

### 4.4 — `useRoundTimer`

```
client/src/hooks/useRoundTimer.ts
```

Computes countdown from `round.timerEndDatetime` (UTC). Updates every second via `setInterval`. Returns:
```typescript
{
  remaining: number;        // seconds remaining; negative = overtime
  isOvertime: boolean;
  isTopEight: boolean;      // true when timerDurationMinutes is null
  urgency: 'success' | 'warning' | 'urgent';
}
```

Urgency rules:
- `urgent`: `remaining <= 0` (overtime) OR `outstandingTables >= 5`
- `warning`: `remaining <= 5 * 60` (< 5 min) OR `outstandingTables >= 1`
- `success`: everything else

**Always null-check `timerDurationMinutes` before doing any computation.** If null, return `{ isTopEight: true, urgency: 'success', ... }`.

---

## Step 5 — Layout Shell

### File layout

```
client/src/components/layout/
  Shell.tsx          — outermost: ContextBar + (TopBar or BottomNav) + content area
  ContextBar.tsx     — 56px sticky bar, tournament name + round always visible
  TopBar.tsx         — desktop only: pf-logger logo + tournament selector + worker status
  TabBar.tsx         — mobile: fixed 72px bottom nav; desktop: 44px sticky top tabs
```

### `ContextBar`

Always visible on all viewports. Height: `var(--space-context-bar)` (56px). Sticky, `z-index: var(--z-sticky)`.

Content:
- Left: tournament name (13px Semi Bold) + round info (11px Regular, muted)
- Right: live dot (green ellipse 8px) + "Live" label, OR last-updated time

Uses `useWorkerStatus()` for the freshness indicator. On `isStale`: swap to amber "Stale · Xm ago". On `error`: swap to red dot.

### `TabBar`

Two render modes controlled by a media query / window width:

**Mobile (≤768px):** `position: fixed; bottom: 0; height: 72px`. Background `--color-bg-overlay`. Tab items: icon (22×22 via inline SVG or unicode drawn with CSS) + label (8px). Active tab: `--color-info`, top 2px indicator. Badges: absolute-positioned 14px pills.

**Desktop (≥1024px):** `position: sticky; top: 56px` (below ContextBar). Height: 44px. Background `--color-bg-surface`. Tabs horizontal, active underline 2px.

Tab badge logic:
```
Dashboard:  dot (8px circle, color = urgency) when outstanding > 0 OR overtime
Logs:       count badge (drops + extensions + penalties + coverage + judge_calls this round); clears when tab viewed
Session:    '!' badge when pfJwtExpiresAt < 30 min → amber; expired → red
```

### Tab icons (SVG primitives, inline)

Draw from SVG path data. Implement as `<svg>` elements with `currentColor` fill so they inherit the tab's active/inactive color:

- **Dashboard:** 2×2 grid of 4 rounded squares (9×9 each, 2px gap)
- **Logs:** 3 horizontal bars (`rx=2`), widths 18px / 14px / 10px, 3px tall, 5px apart
- **Insights:** 3 vertical bars ascending left-to-right (5×10, 5×16, 5×20), gap 3px
- **Data:** table grid (22×9 rect / 22×9 rect, with 2 vertical dividers at x=7 and x=14)
- **Session:** ellipse head (9×9) + rounded rect shoulders (16×8, radius 4)
- **Manage:** gear shape — outer circle + 4 rectangular teeth + inner hole circle (use SVG `<circle>` + `<rect>` elements)

---

## Step 6 — Auth Flow

### `LoginModal`

Renders as a centered overlay (`z-index: var(--z-modal)`) with a backdrop. Not dismissible — user must authenticate.

Fields: username (text input), password (password input). Submit → `useAuth().login()`. On error: inline error message below the form (never an alert). On success: modal unmounts, app renders normally.

Auto-focus username field on mount. Enter key submits.

### Auth guard

`App.tsx` renders `<LoginModal />` when `!auth.token`. Once authed, renders `<Shell>` with the current tab's view. No routing library needed — tab state is managed in React state (`useState<TabName>('dashboard')`).

---

## Step 7 — Dashboard: Active Round (Screen 1)

This is the most important screen — the main operational view for judges. Build it with care.

**File layout:**
```
client/src/components/dashboard/
  ActiveRound.tsx          — screen container, fetches data, distributes to children
  RoundTimer.tsx           — large countdown + urgency state
  RoundStrip.tsx           — 36px colored bar below ContextBar
  StatChips.tsx            — 4 summary chips (outstanding, w/ext, drops, penalties)
  OutstandingTables.tsx    — numbered table chips, extension-marked
  ExtensionsList.tsx       — extension rows, collapsible
```

### `ActiveRound` — data fetching

Polls `GET /api/dashboard/active-round?tournamentId={id}` every 15 seconds. Response: `ActiveRoundResponse` (see types).

While loading (first fetch): show skeleton `<Panel>` with pulsing background.
On error: show error `<Banner variant="error">`.
On null round (no active round): show empty state — "No active round. Waiting for first sync."

### `RoundStrip`

36px bar immediately below ContextBar. Background + border-bottom color = urgency color bg. Contains: "ROUND {n} · {duration} min" left-aligned in 11px Bold. Right-aligned: status badge (`<Badge variant={urgency} icon="..." label="..." />`).

### `RoundTimer`

The hero element. Largest typography on screen.

```typescript
type RoundTimerProps = {
  round: Round;
  outstandingCount: number;
  onExtend: () => void;    // triggers extend-round modal
};
```

**Render rules:**
1. If `round.timerDurationMinutes === null` → Top-8 variant: render "—" in 48px muted, label "Top 8 / No timer"
2. If `isOvertime` → render negative time (e.g. "-05:22"), apply `className="timer-overtime"` to the text + card border for the CSS pulse animation
3. Otherwise → render countdown, color = urgency token

**Time format:** `MM:SS` (no hours). Negative time: `-MM:SS`. Computed by `useRoundTimer()` hook.

**Card structure:**
- `<Panel variant={urgency} glow={urgency === 'urgent'}>` 
- Timer text: `font-size: var(--text-hero-size)` (80px mobile), `var(--text-3xl-size)` (48px desktop)
- Below timer: "{outstanding} outstanding · {ext} w/ extensions" in 13px muted
- "Extend round" `<Button variant="secondary" size="sm">` — only shown when NOT overtime

### `StatChips`

4 chips in a row. On mobile: 4 across at 80px each. On desktop: flexible width.

Each chip (`StatChip` sub-component):
- Background: `--color-bg-surface`
- Border: 1px solid `var(--color-{variant})` at 40% opacity (muted border for 0 values)
- Value: 24px Bold in variant color; if value === 0, render "—" in `--color-text-tertiary` with class `value-zero`
- Label: 11px Regular muted

Chips: Outstanding (`urgent`), w/ Extensions (`warning`), Drops (`muted`), Penalties (`penalty`).

Source-conditional: **Drops chip hidden when `sources.pf === false`** (Carde-only mode).

### `OutstandingTables`

Collapsible section. Shown only when `outstandingTables.length > 0`.

Each table is a chip: 44×36px, `border-radius: 8px`. Default: `--color-bg-elevated` background. If table is in `tablesWithExtensions`: amber background + amber border, "+ext" label below number.

Section header: "Outstanding tables · {n} tables" — click toggles collapse. Default: expanded.

### `ExtensionsList`

Collapsible section. Only shown when `extensions.length > 0`.

Desktop table columns: TABLE · PLAYER · DURATION · GRANTED BY · TIME. Mobile: stacked cards.

Each row is 52px tall. Left accent bar: `--color-warning`. The "DURATION" cell in amber Bold.

---

## Step 8 — Logs Feed (Screen 3)

**File layout:**
```
client/src/components/logs/
  LogFeed.tsx              — screen container, fetches + groups by round
  FilterBar.tsx            — 7 chips + search + clear button
  RoundGroup.tsx           — collapsible round header + entries
  LogEntry.tsx             — single 52px row
```

### `LogFeed` — data fetching

Polls `GET /api/logs?tournamentId={id}` every 20 seconds. Response: `LogsResponse`.

Groups entries by round number (`entries.filter(e => e.roundId === round.id)`). Current round (highest active round) is expanded by default; all others collapsed.

Tracks a `lastViewed: Date` for the Logs tab badge. When the user is on the Logs tab, update `lastViewed` on each poll response and count entries after that timestamp for the badge.

### `FilterBar`

```typescript
type FilterState = {
  roundId: number | null;   // null = all rounds
  types: Set<LogEntryType>; // 'drop' | 'extension' | 'penalty' | 'coverage' | 'judge_call'
  search: string;
};
```

Chips (in order): All · This Round · Drops · Extensions · Penalties · Coverage · Judge Calls

`coverage` and `judge_call` chips: only rendered when `sources.pf === true`. When `sources.pf === false`, these chips are hidden and their filter is cleared.

"Clear" is a `<Button variant="danger" size="sm">` — NOT a chip. Right-aligned.

Search: `<input type="text">` with debounce (300ms). Searches `playerName`, `tableNumber`, `loggedBy` fields.

### `LogEntry`

52px tall row. This is where alignment matters most — get this exactly right.

```
Layout: [3px accent bar] [12px gap] [badge 28px tall] [12px gap] [name/sub stack] [flex grow] [logged-by] [timestamp]
```

Vertical centering math (all from top of row):
- Row height: 52px
- Badge: 28px tall → `top = (52-28)/2 = 12px`
- Primary name (13px, line-height 18px): `top = (52-18)/2 = 17px`
- Secondary sub (11px, line-height 16px): `top = 17 + 18 = 35px`... use flexbox column instead
- Right column (by + ts): both 11px → use flex column, `justify-content: center`

**Recommended implementation:** Use CSS `display: grid` on the row with fixed column widths:
```css
.log-entry {
  display: grid;
  grid-template-columns: 3px 12px 80px 1fr 160px 80px;
  align-items: center;
  height: 52px;
}
```

Left accent bar color = log type color token. Badge uses `<Badge>` component. All text colors from design tokens.

### `RoundGroup`

Collapsible. Header: 40px tall, `--color-bg-elevated` background.

When group is current active round AND urgency = urgent: header gets `--color-urgent-bg` background + 1px border.

Header content: "Round {n} · {status} · {count} entries" left-aligned. Chevron right-aligned (▾ open / ▸ closed).

---

## Step 9 — Insights: Cross-Round Summary (Screen 2)

**File layout:**
```
client/src/components/insights/
  CrossRoundSummary.tsx    — screen container
  TotalsStrip.tsx          — summary totals across all rounds
  RoundTable.tsx           — the main table
  RoundRow.tsx             — one row per round
  ExtensionHistogram.tsx   — expandable detail (QoL 4)
```

### Data fetching

`GET /api/insights?tournamentId={id}` — called once on mount, refreshed every 30 seconds. Response: `RoundSummary[]`.

### `TotalsStrip`

64px tall, `--color-bg-surface` background, 1px border. Horizontal flex with 5 cells: Total Drops · Total Extensions · Total Penalties · Rounds · Runtime. Each cell: large value (18px Bold, type-colored) + label (10px muted). Divider between cells: 1px opacity-25 vertical line.

### `RoundTable`

Desktop: full table with columns Rd | Status | Drops | Extensions | Outstanding | Time Called | Actual End | Overtime.

Mobile: compact table with Rd | Status | Drops | Ext | Outstanding | Overtime.

**Column alignment:** All data columns right-aligned for scannability. Use `text-align: right` on both `<th>` and `<td>`. Status column left-aligned (it contains a Badge).

**Zero-suppression:** Any cell with value 0 renders "—" with `class="value-zero"` (color: `--color-text-tertiary`). Applied to Drops, Extensions, Outstanding, Overtime columns.

**Row urgency:** Rounds with `overtimeMinutes > 15` OR `outstandingAtTimeCalled >= 5` get:
- Background: `--color-urgent-bg`
- 1.5px border: `--color-urgent` at 50% opacity
- 3px left accent bar in `--color-urgent`

Rounds with `overtimeMinutes > 0` OR `outstandingAtTimeCalled >= 1` get amber equivalent.

**Expandable row:** Click any row → expand a detail panel below it (not a separate page). Detail shows:
- `<ExtensionHistogram>` (if extensions exist)
- Outstanding tables list at time-called
- Close on second click

### `ExtensionHistogram` (QoL 4)

Simple bar chart. X-axis: 5-minute duration buckets (+5, +10, +15, +20, +25+). Y-axis: count. Built with pure CSS bars (no chart library needed for this simple case):

```tsx
const buckets = groupExtensionsByBucket(extensions, 5); // 5-min intervals
// Render as flex bars with height proportional to max count
```

If no extensions: render "No extensions this round" in muted text.

---

## Step 10 — Session Tab

**File layout:**
```
client/src/components/session/
  SessionTab.tsx
```

Ports the existing Session tab functionality. No new design — just uses the new component primitives.

Sections:
1. **JWT status card** — dot indicator (green/amber/red) + expiry countdown + username extracted from JWT
2. **Paste JWT** — `<textarea>` + "Save token" `<Button variant="primary">` → POST `/api/set-token`
3. **Instructions** — step-by-step guide for extracting JWT from DevTools (collapsible)
4. **Clear token** → `<Button variant="danger" size="sm">`

Source-conditional: **entire Session tab hidden when `sources.pf === false`** (no PF = no JWT needed). The tab badge rule also only applies when PF is enabled.

`useWorkerStatus().pfJwtExpiresAt` drives the expiry display. Refresh the worker status immediately after saving a new token.

---

## Step 11 — Data Tab (Raw Explorer)

**File layout:**
```
client/src/components/data/
  DataTab.tsx
  RawTableViewer.tsx
```

Ports the existing raw table explorer. Each table is a collapsible accordion item. Expand → fetch data → render as `<table>`. Pagination: 50 rows at a time with "Load more" button.

Tables to expose: `rounds`, `matches` (last 24h of in-progress snapshots), `drops`, `extensions`, `penalties`, `coverage`, `judge_calls`.

This tab is admin-gated: only renders if `useAuth().isAdmin`.

---

## Step 12 — Manage Tab (P1, Screen 4)

**Prerequisites:** P1.1 Admin API endpoints complete.

**File layout:**
```
client/src/components/manage/
  ManageTab.tsx            — tab container, 3 panels
  TournamentPanel.tsx      — tournaments list + create/edit form
  TournamentForm.tsx       — create/edit form (drawer or modal)
  UsersPanel.tsx           — users table
  UserForm.tsx             — create/edit form
  SessionsPanel.tsx        — active sessions table
```

Superadmin-gated: if `!useAuth().isSuperadmin`, render a 403-style message instead.

### `TournamentPanel`

Table columns: Name · Source badge · Status badge · Rounds · Created · Actions

**Source badge:** `<Badge icon="⬡" label="PF+CARDE" variant="info" />` or `<Badge icon="⬡" label="CARDE ONLY" variant="muted" />`

**Status badge:** `<Badge icon="●" label="Active" variant="success" />` or `<Badge icon="○" label="Ended" variant="muted" />`

**Action buttons** (clearly rectangular, NOT pill-shaped):
- `<Button variant="secondary" size="sm">Edit</Button>` → opens `<TournamentForm>` drawer
- `<Button variant="danger" size="sm">Deactivate</Button>` / `<Button variant="secondary" size="sm">Reactivate</Button>`

"Create tournament" button: top-right of section header, `<Button variant="primary">+ Create tournament</Button>`.

### `UsersPanel`

Table columns: Username · Display Name · Role badge · Status badge · Last Login · Actions

**Role badges:**
- `<Badge icon="★" label="SUPERADMIN" variant="penalty" />`
- `<Badge icon="◆" label="HEAD JUDGE" variant="warning" />`
- `<Badge icon="◇" label="JUDGE" variant="info" />`

**Action buttons:**
- `<Button variant="secondary" size="sm">Edit</Button>`
- `<Button variant="warning" size="sm">Reset PW</Button>` → inline confirm step
- `<Button variant="danger" size="sm">Suspend</Button>` / `<Button variant="secondary" size="sm">Reinstate</Button>`

Own row: role and deactivate buttons disabled (cannot deactivate self).

### `SessionsPanel`

Table columns: User · IP · Created · Expires · Actions

Single action: `<Button variant="danger" size="sm">Revoke</Button>` → DELETE `/api/admin/sessions/:token`

---

## Source-conditional rendering — complete map

Controlled by `useTournament().sources`. Applied per-component, never scattered:

| UI element | `sources.pf` required | `sources.carde` required |
|---|---|---|
| Drops stat chip | ✓ | — |
| Drops filter chip | ✓ | — |
| Drops column in round table | ✓ | — |
| Coverage filter chip | ✓ | — |
| Judge Calls filter chip | ✓ | — |
| Session tab (entire tab) | ✓ | — |
| Session tab badge | ✓ | — |
| Extensions (in PF+Carde mode) | ✓ | — |
| Extensions (in Carde-only mode) | — | ✓ (from `time_extension_seconds`) |
| Round timer + outstanding tables | — | ✓ |
| Pairings / match data | — | ✓ |

When columns are hidden in Carde-only mode: remaining columns expand via `flex: 1` or grid `fr` units. No empty gaps.

---

## Overtime CSS animation

Defined in `global.css` (see Step 1.1). Applied by `RoundTimer` via a conditional className:

```tsx
<div className={`timer-value ${isOvertime ? 'timer-overtime' : ''}`}>
  {formatTime(remaining)}
</div>
```

The animation pulses the **entire timer card** (text + border) between full opacity and 0.4 at 1Hz. Applied to both the text element and the card border via:

```css
.panel-overtime.timer-overtime {
  animation: overtime-pulse 1s ease-in-out infinite;
}
```

Panel urgency classes (`state-urgent`, `state-warning`, `state-success`) from `tokens.css` handle the background/border color. `timer-overtime` adds the pulse on top.

---

## QoL items that slot naturally into this build

These are from `plans/qol.md` and are cheap to do alongside the React components they touch:

| QoL | Slot in during | What it is |
|---|---|---|
| QoL 7 — Collapsible round blocks | Step 8 (Logs) | Already designed into `RoundGroup` — just ensure collapse state is persisted in `localStorage` |
| QoL 8 — Quick filter presets | Step 8 (Logs) | `FilterBar` already has the chip design — this is just the implementation |
| QoL 12 — Filter/sort persistence | Step 8 (Logs) | `localStorage` in the `FilterBar` state hook |
| QoL 5 — New since last sync badge | Step 8 (Logs) | `lastViewed` timestamp already described in Logs data fetching above |
| QoL 1 — Logistics filtering | Step 8 (Logs) | Filter logic in `FilterBar` state |
| QoL 3 — Round pace indicator | Step 7 (Dashboard) | Urgency badge on RoundStrip already does this visually |
| QoL 11 — Keyboard shortcuts | Any step | `useEffect` + `keydown` event listener. Suggested: `D`=Dashboard, `L`=Logs, `I`=Insights |
| QoL 6 — Operator notes per round | Step 12 (Manage) / P1 | Needs API endpoint first (P1.1) |
| QoL 9 — Copy round summary | Step 12 / P1 | Button in Dashboard or Insights → clipboard |
| QoL 4 — Extension histogram | Step 9 (Insights) | `ExtensionHistogram` component already designed |
| QoL 13 — What changed diff banner | Step 8 (Logs) | Compare log counts between poll responses, show banner |

---

## Verification checklist

### Bootstrap (Step 0)
- [ ] `npm run dev` starts both Vite (port 5173) and Express (port 8080); `/api/*` proxies correctly
- [ ] `npm run build` produces `dist/` with compiled server + `client/dist/` with React bundle
- [ ] `npm run typecheck` passes with no errors on both `src/` and `client/src/`
- [ ] `npm run lint` passes clean

### Design system (Steps 1–2)
- [ ] All token CSS variables resolve (no `var(--xxx)` fallbacks hit)
- [ ] `Badge` renders all 8 badge variants correctly, always pill-shaped
- [ ] `Button` renders all 5 variants, always rectangular (never pill-shaped)
- [ ] `FilterChip` renders active/inactive states; `pfOnly` prop shows/hides PF superscript

### Auth (Step 6)
- [ ] Login flow works: submit → token in `localStorage` → modal disappears
- [ ] 401 response clears token and re-shows `<LoginModal>`
- [ ] `useAuth().isAdmin` and `.isSuperadmin` reflect `/api/me` response correctly

### Dashboard (Step 7)
- [ ] Timer counts down in real time; updates every second without page refresh
- [ ] `timerDurationMinutes === null` → Top-8 variant renders "—", no NaN
- [ ] Overtime: timer goes negative ("-05:22"), CSS pulse animation active
- [ ] Urgency states: success (green), warning (amber), urgent (red + glow) all apply correctly
- [ ] Outstanding table chips correct: extension-marked tables amber, others default
- [ ] Drops stat chip hidden when `sources.pf === false`
- [ ] Mobile layout at 375px: no horizontal scroll, all touch targets ≥ 44px

### Logs (Step 8)
- [ ] All 5 log types render with correct badge, icon, left accent bar, and alignment
- [ ] Coverage + Judge Calls filter chips hidden when `sources.pf === false`
- [ ] Current round group expanded by default; older rounds collapsed
- [ ] Filter chips correctly filter entries; "Clear" resets all
- [ ] Search debounces correctly (300ms); no layout jump on empty results
- [ ] Tab badge count is accurate; clears when tab is viewed

### Insights (Step 9)
- [ ] All 0 values display as "—" in muted color (zero-suppression)
- [ ] Urgent rows get red background + left accent bar
- [ ] Expandable row shows histogram + outstanding tables; collapses on second click
- [ ] Totals strip totals match sum of individual round rows

### Session tab (Step 10)
- [ ] Entire Session tab absent from TabBar when `sources.pf === false`
- [ ] JWT expiry countdown accurate; amber when < 30 min, red when expired
- [ ] Saving a new token → worker status refreshes immediately

### Manage tab / P1 (Step 12)
- [ ] Tab only visible to superadmin; non-superadmin sees access-denied message
- [ ] Badges (pill) and buttons (rect) are visually distinct at a glance
- [ ] Tournament source toggle → `sources` in `TournamentContext` updates without page reload → Drops chip hides in real time
- [ ] Own user row: role edit and deactivate disabled
- [ ] Creating a tournament → appears in tournament selector immediately

### Cross-cutting
- [ ] Dark mode renders correctly everywhere; no hardcoded light-mode colors
- [ ] All source-conditional elements controlled by `useTournament().sources` only — no other mechanism
- [ ] Worker stale banner appears when data > 2 min old; disappears when data freshens
- [ ] No `console.error` in browser dev tools during normal operation
