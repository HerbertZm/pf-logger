# QoL Checkpoint 0 — Before Phase 0

> **Superseded by the React rewrite.** These vanilla JS improvements targeted the Python/SQLite frontend and are no longer worth implementing there. All equivalent functionality will be built natively in React as part of P0.8 and the Design Phase. Skip this checkpoint unless a near-term event requires the Python app to remain in service past P0 completion.

~~Ship these against the current Python/JS codebase before starting the rewrite. All are pure frontend — no schema changes, no new endpoints.~~

| Item | Notes |
|---|---|
| QoL 8 — Quick Filter Presets | Implement in React Logs component |
| QoL 11 — Keyboard Shortcuts | Implement via React `useEffect` / event listeners |
| QoL 12 — Filter/Sort Persistence | `localStorage` hook in React |
| QoL 5 — New Since Last Sync Badge | Worker state hook + tab badge component |
| QoL 7 — Collapsible Round Blocks | Accordion component in React |
| QoL 1 — Logistics Filtering | Filter logic in React state |
| QoL 3 — Round Pace Indicator | Badge component tied to round timing data |

---

# Phase 0 — Foundation Rewrite

**Goal:** Replace the Python/SQLite prototype with a TypeScript + PostgreSQL stack. No new features until this is stable.

**Stack:** Node.js + TypeScript (strict mode), Express, Prisma ORM, PostgreSQL (VPS), dotenv. React 18 + Vite for the frontend — served as a built `dist/` in production, proxied via Vite dev server in development.

**Key architecture decisions:**
- Source-separated schema: raw layer (verbatim API data) → normalized layer (app queries) → app layer (tool-owned). Full spec in `docs/SCHEMA_DESIGN.md`.
- `tournament_source_mapping` table with `is_enabled` toggle handles multi-source config and Carde-only mode without destructive row deletion.
- TIMESTAMPTZ on every timestamp column; Carde EDT timestamps converted to UTC at ingestion.
- `timer_end_datetime` always computed locally; `completed_at` stored verbatim but never used for any computation.
- PF staff ≠ players ≠ app users — three distinct identity concepts, three distinct tables.
- Selective match storage: worker fetches only in-progress matches via `status=in_progress` filter (confirmed functional). Never fetches full match lists.
- Existing SQLite DB kept at `data/legacy.db` as read-only reference; no migration to new schema.

---

## P0.1 — API Surface Documentation

**✅ Complete (2026-05-21).** Full confirmed schemas in `agent/CARDE_IO.md` and `agent/PURPLEFOX.md`. Implementation quick references in `docs/carde-api.md` and `docs/pf-api.md`. Exploration checklist: `plans/p0-api-exploration.md`.

Key findings:
- `timer_end_datetime` lives on `v2/organize/events/{id}/detail/` only — compute locally as `started_at + (timer_duration_min * 60s)`; +7–83s server lag
- PF extensions have a direct `round` column in `tournament_logs` — no timestamp inference needed
- PF judge calls and coverage are both on the `tables` row — no separate table
- `tournament_drops` (not `drops`), `tournament_penalities` (extra 'i') confirmed
- PF `tables`, `table_status`, `tournament_time` are current-round-only — wiped on every round advance

---

## P0.2 — Project Bootstrap

```
src/                          — Express API (TypeScript, strict)
  server.ts                   — Express app + entry point
  db/
    schema.prisma             — Prisma schema
    migrations/               — Prisma migration files
  ingestion/
    worker.ts                 — Background ingestion coordinator
    providers/
      carde.ts                — Carde.io fetcher
      purplefox.ts            — PurpleFox/Supabase fetcher
  routes/
    tournaments.ts
    admin.ts
    session.ts
    sync.ts
  middleware/
    auth.ts
    rateLimit.ts

client/                       — React frontend (Vite + TypeScript)
  src/
    main.tsx                  — React entry point
    App.tsx                   — Root component, tab routing
    api/
      client.ts               — apiFetch(), Bearer token, 401 handling
      types.ts                — Shared API response types (mirrored from backend)
    components/
      layout/                 — Shell, TopBar, TabBar, ContextBar
      dashboard/              — ActiveRound, RoundTimer, OutstandingTables
      logs/                   — LogFeed, LogEntry, FilterBar
      insights/               — CrossRoundSummary, RoundRow
      manage/                 — TournamentList, UserTable, SessionTable
      shared/                 — Badge, Button, Panel, Modal, Toast
    hooks/
      useWorkerStatus.ts      — Worker state polling (SSE or interval)
      useTournament.ts        — Tournament + source config context
      useAuth.ts              — Auth state, login, logout
    context/
      AuthContext.tsx          — Auth state provider
      TournamentContext.tsx    — Active tournament + sources provider
    styles/
      tokens.css              — CSS custom properties (design tokens only)
      global.css              — Reset + base styles
  index.html                  — Vite entry HTML
  vite.config.ts              — Proxy /api → Express in dev, build to dist/
  tsconfig.json

.env                          — Local config (gitignored)
.env.example                  — Template (checked in)
```

**Dev setup:** `tsc --strict`, ESLint + Prettier on both `src/` and `client/src/`. Vite dev server proxies `/api/*` to Express so the React app and API server run independently. `npm run dev` starts both concurrently via `concurrently`.

**Production serving:** Express serves `client/dist/` as static files with a SPA fallback (`*` → `index.html`). No separate web server needed for frontend assets.

---

## P0.3 — Source-Separated Schema

Full spec in `docs/SCHEMA_DESIGN.md`. Summary:

**Raw layer (`raw_*`)** — verbatim API data, append-only, TIMESTAMPTZ everywhere.
```
raw_carde_rounds      raw_carde_matches (in-progress only, status=in_progress)
raw_pf_drops          raw_pf_penalties       raw_pf_extensions
raw_pf_coverage       raw_pf_judge_calls     raw_pf_staff
```

**Normalized layer** — business-logic tables derived from raw; what the app queries.
```
rounds     matches    drops      penalties  extensions
table_coverage        table_judge_calls     pf_staff
```

**App layer (`app_*`)** — no source dependency.
```
app_tournaments       tournament_source_mapping (is_enabled toggle)
app_users             app_sessions      app_activity      worker_state
pf_session            (JWT metadata singleton — token never stored, only expires_at)
```

---

## P0.4 — Background Ingestion Worker

> **Moved to Phase 1.** The stack is functional with manual sync for now. Full worker implementation deferred until Phase 1 operational tooling is in place.

Module at `src/ingestion/worker.ts`, same deployment as HTTP server. Runs independently.

- Polls Carde on a configurable interval per active tournament using `status=in_progress` — never fetches full match lists
- At `timer_end_datetime`, immediately fetches in-progress matches and stores result as `rounds.missing_tables_json` with `snapshot_captured_at` timestamp
- Subscribes to PurpleFox Supabase real-time where JWT is valid; falls back to polling
- Writes to raw tables only; triggers normalized layer update after each raw write
- Stores per-tournament state in `worker_state` table — survives restarts
- `is_ghost_match` flag captured from Carde but treated as informational only — ghost marking may happen outside Carde

---

## P0.5 — HTTP API Port

Port all existing endpoints to TypeScript + Express. Auth, session, tournament, sync, logs — all reading from PostgreSQL via Prisma.

Includes: hashed passwords (bcrypt), persistent sessions, rate limiting, `PF_PASSWORD_PEPPER` from env.

### API contract

All routes return `application/json`. Auth routes require `Authorization: Bearer <token>` (app session token). The PF JWT is managed separately via `/api/session/pf-jwt` and is never included in Bearer auth.

**Auth**

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/login` | none | `{ username, password }` → `{ token, username, role }` |
| POST | `/api/logout` | Bearer | Deletes session row |
| GET | `/api/me` | Bearer | `{ username, role }` |

**PF Session** — JWT is short-lived (~48h), entered at runtime via UI. Never stored in DB or `.env`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/session/pf-jwt` | Bearer (admin+) | `{ jwt: string }` → validates JWT, stores in jwtStore, writes metadata to `pf_session` |
| GET | `/api/session/pf-jwt` | Bearer | `{ status: 'valid'|'expired'|'missing', expiresAt: string|null, setBy: string|null, inMemory: boolean }` — never returns the token |
| DELETE | `/api/session/pf-jwt` | Bearer (admin+) | Clears jwtStore; updates pf_session record to mark cleared |

`inMemory: false` means the server restarted since the JWT was last pasted — UI shows "re-paste required" even if `expiresAt` is in the future.

**Tournaments**

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/tournaments` | Bearer | Active tournaments with source config (`{ id, name, shortName, isActive, isEnded, sources: { pf, carde } }`) |

**Dashboard** (per tournament, all via query param `?tournamentId=:id`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/dashboard/active-round` | Bearer | Active round + outstanding tables + extensions + drop/penalty counts |
| GET | `/api/logs` | Bearer | All log entries (drops, extensions, penalties, coverage, judge calls) sorted by time |
| GET | `/api/insights` | Bearer | Per-round summary stats |

**Worker**

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/worker-status` | Bearer | `{ isRunning, lastSync, error, pfJwtExpiresAt }` per tournament |
| POST | `/api/sync` | Bearer (admin+) | `{ tournamentId, sources?: ['carde','purplefox'] }` → manual sync trigger |

**System**

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | none | `{ ok, uptime, db }` — DB liveness check |
| GET | `/api/data/:table` | Bearer (admin+) | `?tournamentId=&limit=&offset=` — raw table explorer |

**Admin** — all superadmin-gated; full spec in `plans/phase-1.md` section 1.1.

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/admin/tournaments` | List all / Create |
| PATCH | `/api/admin/tournaments/:id` | Edit name, external IDs |
| PATCH | `/api/admin/tournaments/:id/sources` | Toggle source enabled/disabled |
| GET/POST | `/api/admin/users` | List / Create |
| PATCH | `/api/admin/users/:username` | Edit role / password / active |
| GET/DELETE | `/api/admin/sessions/:token` | List active / Revoke |
| GET | `/api/admin/backup` | PostgreSQL dump stream |

---

## P0.6 — Legacy Data Export + Server Import

Two-step migration — local machine never needs direct DB access to the production server.

**Step 1 — Export (local):**
```bash
npm run db:export-legacy
# Reads action_logs.db in the project root
# Writes legacy-export.json (gitignored)
```

**Step 2 — Upload (to server):**
```bash
curl -X POST https://<host>/api/admin/import \
     -H "Authorization: Bearer <superadmin-token>" \
     -H "Content-Type: application/json" \
     -d @legacy-export.json
```

The import endpoint (`POST /api/admin/import`) is superadmin-gated, idempotent (safe to re-run if interrupted), and returns a verification summary:
```json
{
  "created": { "tournaments": 4, "rounds": 32, "drops": 180, "penalties": 14, "extensions": 27, "coverage": 0, "judgeCalls": 0, "activity": 27 },
  "skipped": { "tournaments": 0, "rounds": 0, "dropsSkippedNoAppId": 0, "judgeCallsNullRound": 0 },
  "totalsInExport": { "tournaments": 4, "rounds": 32, "drops": 180, ... }
}
```

**Note:** Round pairings and match-level data cannot be migrated from the legacy schema (not stored there). Historical drops, penalties, extensions, coverage, judge calls, and round timing records are all preserved.

**Verification:** `created.*` should equal `totalsInExport.*` for all tables on a clean import. Non-zero `skipped.*` values on a re-run are expected and safe.

---

## P0.7 — .env Config

```
DATABASE_URL=postgresql://user:pass@host/db
CARDE_API_TOKEN=...          # long-lived; from Carde.io admin panel
SUPABASE_URL=https://upbcarvmkmyzhbosheyo.supabase.co
SUPABASE_ANON_KEY=...        # public key embedded in PF frontend bundle; safe to check in .env.example
PF_PASSWORD_PEPPER=...
PORT=8080
NODE_ENV=production
```

**PF JWT does NOT go here.** It expires in ~48h, is tied to a specific staff member's Discord session, and must be re-pasted at runtime via the Session panel. Store it only in `jwtStore.ts` (memory) and write only its metadata (`expires_at`, `set_by`, `set_at`) to the `pf_session` table.

`.env.example` checked in with placeholder values. `.env` gitignored. No hardcoded secrets anywhere in the codebase.

---

## P0.8 — React + Vite Frontend

Replace the vanilla JS `index.html` with a React 18 + Vite application. This is the only frontend implementation — there is no intermediate vanilla JS port.

> **Detailed implementation plan:** `plans/ui-implementation.md` — covers Steps 0–12: bootstrap, design system, shared primitives, API client + types, context providers + hooks, layout shell, auth flow, Dashboard (Screen 1), Logs Feed (Screen 3), Insights (Screen 2), Session panel (gear icon — not a primary tab), Data tab, and Manage tab (P1). Includes per-component prop specs, CSS alignment math, source-conditional rendering map, QoL slot-in table, and a full verification checklist. Also read `plans/ui-code-patterns.md` for concrete implementations of all contexts, hooks, API client, and shared types before writing any component code.

### Tooling setup

- `npm create vite@latest client -- --template react-ts` to scaffold the client
- Root-level `package.json` scripts: `dev` (concurrently: Vite + `ts-node-dev src/server.ts`), `build` (Vite build → `client/dist/`), `start` (Express serving `client/dist/`)
- Vite proxy config: all `/api/*` requests forwarded to `http://localhost:${PORT}` in dev mode
- ESLint + Prettier applied to `client/src/` alongside `src/`
- `client/tsconfig.json` inherits strict settings; types shared where possible via `client/src/api/types.ts`

### Core infrastructure (implement first)

**`api/client.ts`** — mirrors current `apiFetch()` behavior: adds `Authorization: Bearer` header, reads token from `localStorage`, on 401 clears token and triggers re-auth flow. Returns typed response or throws with `.status` attached.

**`context/AuthContext.tsx`** — auth state (`token`, `username`, `isAdmin`), `login()`, `logout()` actions. Wraps the app; all components read via `useAuth()` hook.

**`context/TournamentContext.tsx`** — active tournament ID, tournament list, `sources` config (which sources are enabled), last worker sync time. Wraps dashboard routes; components read via `useTournament()`.

**`hooks/useWorkerStatus.ts`** — polls `/api/worker-status` (or subscribes via SSE when P2 SSE is implemented). Returns `{ lastSync, isRunning, error }`. Used by the persistent `ContextBar` to show freshness.

### Design system foundation (implement alongside components)

The design system is built in `client/src/styles/`. **The Design Phase is complete** — `client/src/styles/tokens.css` is the authoritative token file; do not invent token names, read it directly before writing any CSS. Key finalized tokens to be aware of:

```
tokens.css     — finalized token surface (read the file — this is a summary only):
                 Semantic colors: --color-urgent/warning/success/info/muted/pending
                 Backgrounds: --color-bg-base/surface/elevated/chrome/hover/scrim/skeleton
                 Text: --color-text-primary/secondary/tertiary/disabled
                 Spacing: --space-1 through --space-24 (4px base)
                 Type: --text-hero/3xl/2xl/xl/lg/body/base/sm/xs
                       Note: --text-body (17px) is larger than --text-base (15px)
                 Transitions: --transition-fast (0ms) / --transition-base (60ms ease) / --transition-slow (100ms ease)
                 Z-index: --z-base/raised/dropdown/sticky/tab-bar/modal/toast
                 Component tokens: --btn-*, --badge-*, --panel-*, --input-*, --chip-*, --log-row-*, --stat-chip-*
                 Note: --chip-height is 44px — matches the 44px minimum touch target rule

global.css     — CSS reset, body defaults (dark background, Inter with system font fallback), focus rings
```

Component styles use plain CSS files co-located with their component (`Button.css` next to `Button.tsx`), importing tokens via `var(--token-name)`. No CSS-in-JS, no Tailwind — keeps the design system portable and the token surface inspectable.

### Component build order

Build components in dependency order so each phase is testable:

1. **Shared primitives** — `Badge`, `Button`, `Panel`, `Spinner`, `Toast` — stateless, driven entirely by props
2. **Layout shell** — `TopBar` (tournament name, current round, freshness), `TabBar` (tabs with badge support), `ContextBar` — these wrap all views
3. **Auth flow** — `LoginModal`, `useAuth` hook, `AuthContext` — unlocks everything else
4. **Dashboard** — `ActiveRound` (timer, outstanding tables, drop/penalty counts), `RoundTimer` (large countdown, color-shifts by urgency), `OutstandingTables` (collapsible list)
5. **Logs** — `LogFeed` (grouped by round), `LogEntry` (type badge + details), `FilterBar` (quick-filter presets + search)
6. **Insights** — `CrossRoundSummary` (one row per round table), `RoundRow` (cells with zero-suppression)
7. **Manage** — `TournamentList`, `UserTable`, `SessionTable` — admin-gated via `useAuth().isAdmin`

### Source-aware rendering

`TournamentContext` exposes a `sources` object: `{ pf: boolean, carde: boolean }`. Components read this to conditionally render columns and sections. No conditional logic scattered across render functions — one context value controls all source-conditional visibility. This mirrors the design spec in `plans/design.md` D.5.

### Port parity checklist

Before P0.8 is complete, every current Python API route must have a working React consumer:

- Login / logout / session persistence
- Tournament selector + auto-load
- Logs feed (drops, extensions, penalties, coverage, judge results)
- Round timer display with countdown
- Insights / cross-round summary
- Worker status indicator
- Admin: raw table explorer (Data tab)
- PF Session panel (PF JWT paste + status) — accessed via gear icon in TopBar/ContextBar, not a primary tab

---

## Verification Checklist

**Backend**
- All sync/log flows work against PostgreSQL
- App sessions survive server restart (stored in DB)
- Raw tables contain verbatim API data; normalized tables match what the old UI showed
- Carde-only tournament: PF fetches skipped, `is_enabled=false` on PF mapping row
- Worker captures `missing_tables_json` at timer expiry without manual sync trigger
- SQLite data migrated (drops, extensions, penalties, rounds) with no row loss
- `.env` controls all long-lived secrets; PF JWT is NOT in `.env`
- Ingestion worker and HTTP server run independently (worker crash doesn't take down HTTP)
- `POST /api/session/pf-jwt` stores token in memory, writes only metadata to `pf_session` table
- `GET /api/session/pf-jwt` returns `inMemory: false` after server restart (prompts re-paste)
- JWT token is never returned by any endpoint; never appears in any DB column

**Frontend (React + Vite)**
- `npm run dev` starts both Vite dev server and Express; `/api/*` proxies correctly
- `npm run build` produces `client/dist/`; Express serves it with SPA fallback
- Login flow, token persistence, and 401 re-auth all work in React
- Tournament selector loads and auto-fetches on mount
- Logs feed renders drops, extensions, penalties, coverage, judge results
- Round timer counts down in real time; color-shifts as urgency increases
- Cross-round summary renders one row per round with zero-suppression
- Source-conditional columns hide/show correctly based on `tournament_source_mapping`
- Worker status freshness indicator updates without page refresh
- Admin Data tab: raw table pagination works
- Mobile layout renders at 375px without horizontal scroll
- All interactive elements meet 44px minimum touch target
