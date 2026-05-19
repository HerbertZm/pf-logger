# pf-logger — UI Implementation Plan

**Goal:** Replace the Python/SQLite prototype with a React 18 + Vite frontend backed by the TypeScript + Express + PostgreSQL stack from Phase 0.

**Design reference:** https://www.figma.com/design/czEoZNIW8dHjbiea6OwlOi  
**Tokens:** `client/src/styles/tokens.css` (complete, checked in)  
**Concrete implementations:** `plans/ui-code-patterns.md` — read this alongside each step.

---

## When Figma changes — what to update

| What changed in Figma | What to update in the repo |
|---|---|
| Color, spacing, font size, shadow, radius | `client/src/styles/tokens.css` — the single source of truth for all visual values |
| Component behavior, props, new variant, interaction rule | The relevant step section in this file (`ui-implementation.md`) |
| New screen or major layout restructure | The relevant step section here + `docs/design-spec.md` if it exists |
| Badge vs CTA rules, urgency logic, source-conditional map | The named sections at the bottom of this file |

`tokens.css` + `ui-implementation.md` are the two files an agent reads before any UI work. If both are accurate to Figma, an agent can execute without needing Figma access directly.

---

## Tab mapping (old → new)

| Old | New | Notes |
|---|---|---|
| Logs | Logs | Redesigned — grouped + filterable |
| Session | Session | PF JWT mgmt |
| Data | Data | Raw table explorer |
| Tools | Manage → Tournament panel | P1 |
| Activity | Manage → Audit log | P1 |
| *(none)* | **Dashboard** | New primary view — timer + outstanding tables |
| *(none)* | **Insights** | New — cross-round summary |
| *(none)* | **Manage** | New — P1, superadmin only |

---

## Prerequisites

P0.2 (scaffold), P0.3 (schema live), P0.4 (worker running), P0.5 (API ported). Frontend steps 1–3 can proceed before the backend is complete — use mock data.

---

## Build order

```
Step 0  Bootstrap
Step 1  Design system
Step 2  Shared primitives
Step 3  API client + types
Step 4  Context + hooks         ← see ui-code-patterns.md §4
Step 5  Layout shell
Step 6  Auth flow
Step 7  Dashboard (Screen 1)
Step 8  Logs Feed (Screen 3)
Step 9  Insights (Screen 2)
Step 10 Session tab
Step 11 Data tab
Step 12 Manage tab (P1)
```

---

## Step 0 — Bootstrap

### Packages

```bash
# Root
npm i concurrently ts-node-dev
npm i -D typescript eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser \
  eslint-plugin-react-hooks prettier eslint-config-prettier

# Client
cd client
npm create vite@latest . -- --template react-ts
npm i                          # installs React 18, vite, typescript
```

Delete Vite boilerplate: `App.css`, `assets/`, contents of `App.tsx` and `index.css`.

### `client/index.html` — add Inter font

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### Root `package.json` scripts

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

### `client/vite.config.ts`

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
  build: { outDir: '../dist/client' },
});
```

### `client/tsconfig.json`

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

### `.eslintrc.json`

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

**Checkpoint:** `npm run dev` → Vite at :5173, Express at :8080, `/api/*` proxies correctly. `npm run typecheck` clean.

---

## Step 1 — Design system

`tokens.css` is already complete. Add `global.css` and wire everything up.

### `client/src/styles/global.css`

```css
@import './tokens.css';

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

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

@keyframes overtime-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
.timer-overtime { animation: overtime-pulse 1s ease-in-out infinite; }

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

### CSS architecture

One co-located `.css` file per component, imported directly from the `.tsx`. No CSS-in-JS, no Tailwind. All values via `var(--token)`.

```
components/shared/
  Badge.tsx   Badge.css   ← import './Badge.css' at top of Badge.tsx
  Button.tsx  Button.css
  ...
```

`global.css` is imported **once** in `client/src/main.tsx` — tokens are then globally available to all component CSS files.

---

## Step 2 — Shared primitives

All stateless, prop-driven. **Complete implementations in `plans/ui-code-patterns.md` §2.**

### 2.1 — `Badge`

```typescript
type BadgeProps = {
  icon: string;     // unicode: '↓' '!' '+' '⚖' '◈' '✓' '◐' '⚠' '●' '★' '◆' '◇'
  label: string;    // UPPERCASE
  variant: 'urgent' | 'warning' | 'success' | 'info' | 'muted' | 'penalty';
  disabled?: boolean;
};
```

Shape: **always pill** (`border-radius: 9999px`). Height: 28px. Font: 11px Bold. Background/border from `--color-{variant}-bg` / `--color-{variant}`. **Never clickable.**

### 2.2 — `Button`

```typescript
type ButtonProps = {
  children: React.ReactNode;
  variant: 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
  size?: 'sm' | 'md';     // default: 'md'
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
};
```

Shape: **always rectangular** (`border-radius: 8px`). Height: 44px (md) / 32px (sm). Loading: inline `<Spinner />`.

| variant | bg | text | border |
|---|---|---|---|
| primary | `--color-info` | `#fff` | none |
| secondary | `--color-bg-elevated` | `--color-text-secondary` | `--color-border-default` |
| danger | `--color-urgent-bg` | `--color-urgent` | `--color-urgent` |
| warning | `--color-warning-bg` | `--color-warning` | `--color-warning` |
| ghost | transparent | `--color-text-secondary` | `--color-border-subtle` |

### 2.3 — `Panel`

```typescript
type PanelProps = {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'urgent' | 'warning' | 'success';
  glow?: boolean;
  accentBar?: boolean;  // 3px left bar in variant color
  className?: string;
};
```

`border-radius: var(--radius-lg)`, `padding: var(--panel-padding)`. Glow via `--glow-urgent / --glow-warning / --glow-success`.

### 2.4 — `Spinner`

```typescript
type SpinnerProps = { size?: 'sm' | 'md'; };  // 10px / 16px
```

CSS border-based spinner, `--color-info`, uses `@keyframes spin` from `global.css`.

### 2.5 — `Banner`

```typescript
type BannerProps = {
  variant: 'success' | 'warning' | 'error' | 'info';
  message: string;
  dismissible?: boolean;
  onDismiss?: () => void;
};
```

36px tall, left accent bar (3px, variant color), full-width, stacks below ContextBar.

### 2.6 — `FilterChip`

```typescript
type FilterChipProps = {
  label: string;
  active: boolean;
  pfOnly?: boolean;    // shows 'PF' superscript; parent hides when sources.pf=false
  onClick: () => void;
};
```

Pill shape, height 36px. Active: `--color-info` bg + white text. Inactive: `--color-bg-elevated` + border.

---

## Step 3 — API client + types

**Complete implementation in `plans/ui-code-patterns.md` §3.**

### `client/src/api/client.ts`

Central typed fetch wrapper. Handles auth header injection, 401 → clear token + dispatch `auth:expired`, non-ok → throw `ApiError`.

Export: `api.get<T>`, `api.post<T>`, `api.patch<T>`, `api.delete<T>`.

### `client/src/api/types.ts`

All shared response types. Keep in sync with Prisma output.

**Domain rules baked into types:**
- `Round.timerDurationMinutes: number | null` — `null` means Top-8; always null-check before timer math
- `Round.timerEndDatetime: string | null` — UTC ISO, computed at ingestion; never use `completed_at` for this
- `Extension` — PF-only in PF+Carde mode; from `time_extension_seconds` in Carde-only mode
- `LogEntry` — discriminated union on `type: 'drop' | 'extension' | 'penalty' | 'coverage' | 'judge_call'`

---

## Step 4 — Context providers + hooks

**Complete implementations in `plans/ui-code-patterns.md` §4.**

### `AuthContext`

State: `{ token, username, isAdmin, isSuperadmin }`. Actions: `login()`, `logout()`. On mount: validate token via `GET /api/me`. Listens for `auth:expired` custom event → clear state.

### `TournamentContext`

State: `{ tournaments, activeTournamentId, activeTournament, sources, setActiveTournament }`.

`sources: { pf: boolean; carde: boolean }` derived from `activeTournament`. **This is the single source of truth for all source-conditional rendering.** Persists selection in `localStorage`.

### `useWorkerStatus`

Polls `GET /api/worker-status` every 10s. Returns `{ lastSync, isRunning, error, isStale, pfJwtExpiresAt }`.

`isStale = lastSync && (Date.now() - lastSync.getTime()) > 120_000`.

### `useRoundTimer`

`setInterval` at 1s over `round.timerEndDatetime`. Returns `{ remaining, isOvertime, isTopEight, urgency }`.

Urgency: `urgent` if overtime OR outstanding ≥ 5. `warning` if < 5 min OR outstanding ≥ 1. `success` otherwise.

**Always guard `timerDurationMinutes === null` first** — return `{ isTopEight: true, remaining: 0, isOvertime: false, urgency: 'success' }`.

---

## Step 5 — Layout shell

```
client/src/components/layout/
  Shell.tsx        — outermost: ContextBar + TopBar/BottomNav + content area
  ContextBar.tsx   — 56px sticky, always visible
  TopBar.tsx       — desktop only: logo + tournament selector + worker status
  TabBar.tsx       — mobile: 72px fixed bottom; desktop: 44px sticky top tabs
```

### ContextBar

`position: sticky; top: 0; z-index: var(--z-sticky); height: var(--space-context-bar)`.

Left: tournament name (13px Semi Bold) + round info (11px muted). Right: live indicator from `useWorkerStatus()`. States: green "● Live", amber "⚠ Stale · Xm ago", red "✕ Error".

### TabBar

Two render paths via media query (breakpoint: 768px):

**Mobile:** `position: fixed; bottom: 0; height: 72px`. Each tab: 22×22 SVG icon + 8px label. Active: `--color-info` + top 2px indicator.

**Desktop:** `position: sticky; top: 56px; height: 44px`. Horizontal tabs, active 2px underline.

Tab badge logic:
- Dashboard: 8px dot in urgency color when `outstanding > 0 || isOvertime`
- Logs: count since last viewed; clears on tab focus
- Session: amber `!` when `pfJwtExpiresAt < 30min`; red when expired

### Tab icons — inline SVG

All use `currentColor` so they inherit active/inactive color automatically:

- **Dashboard:** 2×2 grid of 9×9 rounded squares (2px gap, `rx=2`)
- **Logs:** 3 bars (18/14/10px wide, 3px tall, 5px apart)
- **Insights:** 3 ascending vertical bars (5×10, 5×16, 5×20, gap 3px)
- **Data:** table grid (22×9 rects with 2 vertical dividers at x=7 and x=14)
- **Session:** circle head + rounded rect body
- **Manage:** gear (outer ring + 4 rect teeth + inner hole)

---

## Step 6 — Auth flow

### `LoginModal`

Centered overlay, `z-index: var(--z-modal)`. Not dismissible. Controlled form: `username` + `password` inputs. Submit → `useAuth().login()`. Inline error below form (not `alert()`). Auto-focus `username` on mount.

### `App.tsx`

Tab routing via `useState` — no router library:

```typescript
type Tab = 'dashboard' | 'logs' | 'insights' | 'session' | 'data' | 'manage';

function App() {
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>('dashboard');
  if (!auth.token) return <LoginModal />;
  return <Shell tab={tab} onTabChange={setTab}>{/* tab views */}</Shell>;
}
```

---

## Step 7 — Dashboard: Active Round (Screen 1)

```
client/src/components/dashboard/
  ActiveRound.tsx       — container, polls every 15s, distributes data
  RoundStrip.tsx        — 36px colored bar, urgency-keyed
  RoundTimer.tsx        — hero countdown
  StatChips.tsx         — 4 summary chips
  OutstandingTables.tsx — collapsible table chips
  ExtensionsList.tsx    — collapsible extension rows
```

### Polling pattern (same for all data-fetching containers)

```typescript
useEffect(() => {
  fetch();
  const id = setInterval(fetch, 15_000);
  return () => clearInterval(id);
}, [tournamentId]);
```

Loading: skeleton `<Panel>` with pulse. Error: `<Banner variant="error">`. No active round: empty state.

### `RoundTimer`

```typescript
type RoundTimerProps = {
  round: Round;
  outstandingCount: number;
  onExtend: () => void;
};
```

1. `timerDurationMinutes === null` → `"—"` in 48px muted, "Top 8 / No timer"
2. `isOvertime` → `"-MM:SS"`, apply `.timer-overtime` to text + card border
3. Otherwise → countdown, color = urgency token

Font: 80px mobile (`--text-hero-size`), 48px desktop (`--text-3xl-size`).

### `StatChips` — 4 chips

Outstanding (`urgent`) · w/ Extensions (`warning`) · Drops (`muted`) · Penalties (`penalty`).

Zero-suppression: value `0` → `"—"` with `.value-zero` class.

**Drops chip hidden when `sources.pf === false`.**

### `OutstandingTables`

Table chips: 44×36px, `border-radius: 8px`. Extension-marked tables: amber bg + border. Collapsible, expanded by default.

---

## Step 8 — Logs Feed (Screen 3)

```
client/src/components/logs/
  LogFeed.tsx     — container, polls every 20s, groups by round
  FilterBar.tsx   — 7 chips + search + clear
  RoundGroup.tsx  — collapsible header + entries
  LogEntry.tsx    — 52px row
```

### FilterBar state

```typescript
type FilterState = {
  roundId: number | null;
  types: Set<'drop' | 'extension' | 'penalty' | 'coverage' | 'judge_call'>;
  search: string;
};
```

Chips: All · This Round · Drops · Extensions · Penalties · Coverage · Judge Calls

`coverage` and `judge_call` chips: **hidden + cleared when `sources.pf === false`**.

"Clear" = `<Button variant="danger" size="sm">` (rectangular, not a chip). Search: 300ms debounce.

### LogEntry grid layout

```css
.log-entry {
  display: grid;
  grid-template-columns: 3px 12px 80px 1fr 160px 80px;
  /* accent | gap | badge | name/sub | logged-by | timestamp */
  align-items: center;
  height: 52px;
}
```

### Tab badge

Track `lastViewed: number` (timestamp). Badge count = entries after `lastViewed`. Reset on tab focus.

---

## Step 9 — Insights: Cross-Round Summary (Screen 2)

```
client/src/components/insights/
  CrossRoundSummary.tsx
  TotalsStrip.tsx
  RoundTable.tsx / RoundRow.tsx
  ExtensionHistogram.tsx
```

Polls every 30s. Desktop columns: Rd · Status · Drops · Extensions · Outstanding · Time Called · Actual End · Overtime. Mobile: Rd · Status · Drops · Ext · Outstanding · Overtime.

Data columns right-aligned. Zero-suppression on Drops, Extensions, Outstanding, Overtime.

Row urgency: `overtimeMinutes > 15` OR `outstandingAtTimeCalled >= 5` → urgent. `> 0` OR `>= 1` → warning.

Expandable row: click → inline detail panel with `<ExtensionHistogram>` + outstanding list. Second click collapses.

`ExtensionHistogram`: pure CSS bars, 5-min buckets, no chart lib.

---

## Step 10 — Session Tab

Source-conditional: **entire tab hidden when `sources.pf === false`**.

Sections: JWT status card · Paste JWT textarea → `POST /api/set-token` → refresh worker status · DevTools instructions (collapsible) · Clear token button.

Expiry: amber `< 30 min`, red expired. Driven by `useWorkerStatus().pfJwtExpiresAt`.

---

## Step 11 — Data Tab

Admin-gated (`useAuth().isAdmin`). Accordion of raw tables. Each table fetches on expand. Pagination: 50 rows + "Load more".

Tables: `rounds`, `matches`, `drops`, `extensions`, `penalties`, `coverage`, `judge_calls`.

---

## Step 12 — Manage Tab (P1)

**Requires P1.1 admin API endpoints.**

```
client/src/components/manage/
  ManageTab.tsx
  TournamentPanel.tsx + TournamentForm.tsx
  UsersPanel.tsx + UserForm.tsx
  SessionsPanel.tsx
```

Superadmin-gated — render 403 message for non-superadmin.

**Badge vs Button rule:** Badges always pill (informational). Buttons always rectangular (actionable). Enforce via shared components — never custom-style one to look like the other.

### `TournamentPanel`

Columns: Name · Source badge · Status badge · Rounds · Created · Actions

Source badge: `<Badge icon="⬡" label="PF+CARDE" variant="info" />` or `"CARDE ONLY" variant="muted"`.

### `UsersPanel`

Role badges: `★ SUPERADMIN` (penalty) · `◆ HEAD JUDGE` (warning) · `◇ JUDGE` (info). Own row: role + deactivate disabled.

### `SessionsPanel`

Columns: User · IP · Created · Expires · Revoke button.

---

## Source-conditional rendering — complete map

All conditioned on `useTournament().sources`. No other mechanism.

| UI element | `sources.pf` | `sources.carde` |
|---|---|---|
| Drops stat chip | ✓ required | — |
| Drops filter chip | ✓ | — |
| Drops column in round table | ✓ | — |
| Coverage + Judge Calls filter chips | ✓ | — |
| Session tab (entire) | ✓ | — |
| Session tab badge | ✓ | — |
| Extensions source | PF data if ✓ | `time_extension_seconds` if ✓ |
| Round timer + outstanding tables | — | ✓ required |
| Match/pairing data | — | ✓ |

Hidden columns expand via `flex: 1` / `fr` — no empty gaps.

---

## Overtime animation

Defined in `global.css`. Applied by `RoundTimer`:

```tsx
<div className={`timer-value${isOvertime ? ' timer-overtime' : ''}`}>
  {formatTime(remaining)}
</div>
```

`state-urgent` class handles bg/border color. `timer-overtime` adds 1Hz pulse on top.

---

## QoL slots

| QoL | Step | Notes |
|---|---|---|
| 7 — Collapsible round blocks | 8 Logs | `RoundGroup` — persist collapse in `localStorage` |
| 8 — Quick filter presets | 8 Logs | `FilterBar` chips — implement the 7-chip state |
| 12 — Filter/sort persistence | 8 Logs | `localStorage` in FilterBar state |
| 5 — New since last sync badge | 8 Logs | `lastViewed` timestamp already in spec |
| 1 — Logistics filtering | 8 Logs | Filter logic in `FilterBar` |
| 3 — Round pace indicator | 7 Dashboard | Urgency badge on `RoundStrip` |
| 11 — Keyboard shortcuts | Any | `useEffect` keydown: D/L/I/S = tabs |
| 4 — Extension histogram | 9 Insights | Pure CSS bars |
| 6 — Operator notes | 12 / P1 | Needs P1.1 API first |
| 9 — Copy round summary | 12 / P1 | Clipboard button |
| 13 — What-changed banner | 8 Logs | Compare log counts between polls |

---

## Verification checklist

**Bootstrap**
- [ ] `npm run dev` starts Vite (:5173) + Express (:8080); `/api/*` proxies
- [ ] `npm run typecheck` clean; `npm run lint` clean

**Design system**
- [ ] All `var(--token)` values resolve; no fallbacks hit
- [ ] `Badge` always pill-shaped; `Button` always rectangular

**Auth**
- [ ] Login → token in `localStorage` → modal unmounts
- [ ] 401 → token cleared → `<LoginModal>` reappears
- [ ] `isAdmin` / `isSuperadmin` reflect `/api/me`

**Dashboard**
- [ ] Timer ticks in real time; no NaN on null `timerDurationMinutes`
- [ ] Overtime: negative time, pulse animation active
- [ ] Urgency states (success/warning/urgent) correct colors + glow
- [ ] Drops chip absent when `sources.pf === false`
- [ ] Mobile 375px: no horizontal scroll

**Logs**
- [ ] All 5 log types: correct badge, accent bar, grid alignment
- [ ] Coverage + Judge Calls chips absent when `sources.pf === false`
- [ ] Tab badge count accurate; clears on tab focus

**Insights**
- [ ] Zero-suppression: `0` → `"—"` in muted
- [ ] Urgent rows: red bg + left accent bar
- [ ] Totals strip sums match rows

**Session**
- [ ] Tab absent from TabBar when `sources.pf === false`
- [ ] Expiry: amber < 30 min, red expired

**Manage (P1)**
- [ ] Superadmin-only; access-denied message otherwise
- [ ] Tournament source toggle → `sources` in context updates → Drops chip hides live
- [ ] Own user row: role + deactivate disabled

**Cross-cutting**
- [ ] Source-conditional rendering flows through `useTournament().sources` only
- [ ] No hardcoded colors — only `var(--token)`
- [ ] Worker stale banner: appears > 2 min, clears on fresh data
- [ ] No `console.error` during normal operation
