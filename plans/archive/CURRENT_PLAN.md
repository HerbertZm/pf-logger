# pf-logger Master Roadmap

## Context

pf-logger is a tournament operations dashboard for Magic/Riftbound events running on PurpleFox. It pulls from PurpleFox (Supabase) and carde.io, stores data locally, and presents a real-time dashboard for drops, penalties, time extensions, round timing, and judge activity.

**Current pain points driving this roadmap:**
- Tournaments and users are hardcoded in `serve.py` — adding a new event requires code changes
- Sessions lost on server restart — every restart logs everyone out
- Passwords stored in plaintext
- All 1,743 lines of backend live in one file; frontend is a 2,575-line single HTML file
- UI was built iteratively ("vibe-coded") — no design system, inconsistent inline styles, small touch targets
- Only supports Carde + PurpleFox together; no way to use either alone or swap platforms
- No event grouping — tournaments exist as flat list, no concept of a "Regional Weekend"

**Scope of this roadmap:** Consolidates TODO.md and production-ready.md, and adds PostgreSQL migration, data source flexibility, event grouping with per-event permissions, UI overhaul, and code compartmentalization.

**Budget:** ~3–4 hours/day of human-written code (with AI assistance).
- Phase 1 (Month 1): ~60–70 hrs
- Phase 2 (Months 2–3): ~120–140 additional hrs
- Phase 3 (Months 4–6): ~180–210 additional hrs

---

## Constraints to Track

| Constraint | Status | Notes |
|---|---|---|
| No external Python deps | **Will change in Phase 2** | Dropping this to adopt psycopg3 for PostgreSQL |
| No build step | **Retained** | Frontend splits into static files but no bundler |
| Single-server deployment | Retained for now | Docker option added in Phase 3 |
| PurpleFox JWT is manual | Retained | Cannot automate; JWT paste in Session tab |

---

## Phase 1 — Productionization + Structure (Month 1, ~60–70 hrs)

**Goal:** No more code changes between events. All config from the UI. Codebase split into readable modules. UI gets a first-pass design system.

### 1.1 Database: Add 3 Management Tables

All additive migrations — no data loss on existing DB.

**`app_tournaments`** (replaces hardcoded `TOURNAMENTS` dict)
```sql
CREATE TABLE IF NOT EXISTS app_tournaments (
    id                  TEXT PRIMARY KEY,   -- PurpleFox UUID
    name                TEXT NOT NULL,
    short               TEXT NOT NULL,
    carde_event_id      INTEGER,            -- nullable
    carde_base_round_id INTEGER,            -- nullable
    provider_type       TEXT NOT NULL DEFAULT 'purplefox_carde',
    created_at          TEXT NOT NULL,
    created_by          TEXT NOT NULL,
    is_active           INTEGER NOT NULL DEFAULT 1
);
```

**`app_users`** (replaces `USERS`/`ADMINS`/`SUPERADMINS`)
```sql
CREATE TABLE IF NOT EXISTS app_users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,            -- SHA-256(password + pepper)
    role          TEXT NOT NULL DEFAULT 'user', -- 'user'|'admin'|'superadmin'
    created_at    TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    is_active     INTEGER NOT NULL DEFAULT 1
);
```

**`sessions`** (replaces `_sessions` dict — survives restarts)
```sql
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    exp        REAL NOT NULL,
    created_at TEXT NOT NULL,
    ip         TEXT,
    user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_exp ON sessions(exp);
```

**Seed migration** (`INSERT OR IGNORE` — existing data wins):
- Seed hardcoded tournaments from `TOURNAMENTS` dict with `created_by='system'`
- Seed hardcoded users with hashed passwords and their roles

### 1.2 Auth Migration

- Password hashing: `SHA-256(password + PF_PASSWORD_PEPPER)`. Pepper from `os.environ.get("PF_PASSWORD_PEPPER", "pf-logger-default")`.
- Login: DB lookup + hash compare. Rate-limit: 10 attempts/60s per IP → 429.
- Sessions: read/write/delete from `sessions` table. Cleanup expired sessions at startup + hourly `threading.Timer`.
- Remove: `_sessions` dict, `USERS`, `ADMINS`, `SUPERADMINS` constants.
- Add helpers: `_hash_password()`, `_get_user_role(username)`, `_require_admin()`, `_require_superadmin()`, `_cleanup_sessions()`.
- Update `/api/me` and `/api/login` to derive `is_admin`/`is_superadmin` booleans from role column.

### 1.3 Tournament Migration

- Add `_get_tournament_config(tournament_id) → dict` reading from `app_tournaments`.
- Replace all `TOURNAMENTS` references in `/api/tournaments`, `/api/sync`, `/api/end-tournament`, `/api/backfill`.
- Remove hardcoded `TOURNAMENTS` dict.

### 1.4 New Admin API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | None | Uptime, DB size, session count, tournament count |
| GET | `/api/admin/tournaments` | Superadmin | List all (incl. inactive) |
| POST | `/api/admin/tournaments` | Superadmin | Create tournament |
| PATCH | `/api/admin/tournaments/<id>` | Superadmin | Edit name/short/carde IDs/provider |
| DELETE | `/api/admin/tournaments/<id>` | Superadmin | Soft-delete (is_active=0) |
| GET | `/api/admin/users` | Superadmin | List (no password_hash) |
| POST | `/api/admin/users` | Superadmin | Create user |
| PATCH | `/api/admin/users/<username>` | Superadmin | Edit role/password/is_active |
| DELETE | `/api/admin/users/<username>` | Superadmin | Soft-delete + revoke sessions |
| GET | `/api/admin/sessions` | Superadmin | Active sessions |
| DELETE | `/api/admin/sessions/<token>` | Superadmin | Revoke session |
| GET | `/api/admin/backup` | Superadmin | Stream SQLite file (after WAL checkpoint) |

**Guards:** Superadmin cannot deactivate own account. Deactivating a user immediately `DELETE FROM sessions WHERE username=?`. Audit all events via `db_log_activity()`: `tournament_created`, `user_created`, `user_deactivated`, `session_revoked`, `login_failed`, etc.

**Validation:**
- `username`: `^[a-z0-9_-]{3,32}$`
- `password`: 6–128 chars
- `role`: `'user'|'admin'|'superadmin'`
- `carde_event_id`/`carde_base_round_id`: positive int if provided
- `name`/`short`: non-empty, max 128 chars stripped

### 1.5 Code Compartmentalization (serve.py Split)

Split 1,743-line `serve.py` into sibling modules. No external deps — stdlib only. Each module is a plain Python file imported by `serve.py`.

```
serve.py (~200 lines)       — main Handler, do_GET/do_POST dispatch, entry point
db.py (~250 lines)          — all db_* functions, db_init(), db_connect(), schema
api_clients.py (~280 lines) — Supabase/carde fetchers, _carde_worker(), fetch_and_store()
auth.py (~80 lines)         — _require_auth(), session helpers, JWT decode, rate limiting
routes/
  tournaments.py            — /api/tournaments, /api/sync, /api/logs, /api/backfill, /api/end-tournament
  admin.py                  — /api/admin/* endpoints
  session.py                — /api/login, /api/logout, /api/me, /api/set-token, /api/token-status
```

### 1.6 Frontend: Static File Split + Design System Foundation

Split 2,575-line `index.html` into static assets. `serve.py` adds `GET /static/<file>` route.

```
index.html (master shell, ~200 lines)
static/css/
  theme.css      — CSS variables only (colors, spacing, radius, typography)
  layout.css     — grid, flex, structure
  components.css — buttons, panels, badges, tables, modals
static/js/
  api.js         — apiFetch(), sync, proxy
  auth.js        — login, token, session state, applyAdminVisibility()
  ui.js          — tabs, renderAll(), renderRoundBlock(), filters
  insights.js    — renderInsights(), renderInfractions(), stats
```

**Design system additions to `theme.css`:**
- Semantic tokens: `--urgent`, `--success`, `--warning`, `--info`
- Spacing scale: `--space-xs/sm/md/lg/xl` (4/8/16/24/32px)
- Radius tokens: `--radius-sm/md/lg`
- Remove all recurring inline `style=` attributes; replace with CSS classes

**Event-ops UX improvements:**
- Sticky action bar: Fetch/Sync buttons always in viewport
- Larger status indicators (min 44px touch targets)
- Toast notifications for sync events (replace status bar text)
- Tab badges with urgency treatment for infractions
- Countdown timer more visually prominent

### 1.7 Manage Tab (Superadmin-only Frontend)

New tab with 3 lazy-loaded panels:

1. **Tournaments** — list table + inline Edit/Deactivate + Add form (name, short, PF UUID, carde IDs, provider type)
2. **Users** — table with role badge (color-coded) + inline role edit + Reset Password + Deactivate/Reactivate; Create form
3. **Sessions** — active session list with IP, created at, expires at; Revoke button per row

Other UI: Sort ended tournaments to bottom of selector. Gate "End event" button to superadmin only. Improve Session tab JWT extraction instructions (DevTools step-by-step).

### 1.8 Env Var & Config Cleanup (from TODO)

- [ ] `CARDE_API_TOKEN` → `os.environ.get("CARDE_API_TOKEN")`, add to systemd `Environment=`
- [ ] `PF_PASSWORD_PEPPER` → systemd `Environment=`
- [ ] Auto-backfill thread at startup (cheap, ensures timing data always fresh on restart)
- [ ] Structured server logging: `logging.handlers.RotatingFileHandler` (replace stdout-only)
- [ ] Health endpoint: `/api/health` returns uptime, DB size, session count, tournament count

**Phase 1 verification checklist:**
- [ ] Sessions survive server restart
- [ ] Superadmin creates tournament from UI → appears in selector immediately
- [ ] New user can log in with created password
- [ ] Admin cannot reach `/api/admin/users` (403)
- [ ] Rate limit fires at 11th login attempt from same IP (429)
- [ ] All existing sync/log/backfill flows work unchanged

---

## Phase 2 — PostgreSQL, Events, and Provider Layer (Months 2–3, ~120–140 additional hrs)

**Goal:** Multi-event management, per-event permissions, real database for production, and the abstraction layer that allows new tournament platforms to be plugged in.

### 2.1 PostgreSQL Migration

**Decision: Accept psycopg3 (`psycopg[binary]`) as first external dependency.** Drop the "zero deps" constraint.

**Dev/Prod split:** `DATABASE_URL` env var controls backend.
- `DATABASE_URL=sqlite:///action_logs.db` → sqlite3 (dev default)
- `DATABASE_URL=postgresql://user:pass@host/db` → psycopg3 (prod)

**`db.py` wrapper:** `db_connect()` selects driver from `DATABASE_URL` prefix.

**Syntax changes required (all in `db.py`):**

| SQLite | PostgreSQL |
|--------|------------|
| `INSERT OR IGNORE INTO t` | `INSERT INTO t ... ON CONFLICT(...) DO NOTHING` |
| `INSERT OR REPLACE INTO t` | `INSERT INTO t ... ON CONFLICT(...) DO UPDATE SET col=excluded.col` |
| `PRAGMA table_info(t)` | `SELECT column_name FROM information_schema.columns WHERE table_name=?` |
| `PRAGMA journal_mode=WAL` | Delete — not needed |
| `AUTOINCREMENT` | `SERIAL` or `BIGSERIAL` |

**No changes needed:** All `ON CONFLICT DO UPDATE SET` / COALESCE write-once patterns are syntax-identical in PostgreSQL. Three-pass drops upsert and round_timers COALESCE semantics both work identically.

**Connection pooling:** `psycopg.pool.SimpleConnectionPool(min=2, max=8)`. Each request calls `pool.getconn()` / `pool.putconn()` in a try/finally. Background worker gets a dedicated connection from the pool.

**Add to `DEPLOY.md`:** `DATABASE_URL=postgresql://...` in systemd `Environment=`. Document `pip install "psycopg[binary]"` as new required step.

### 2.2 Event Grouping + Per-Event Permissions

Three new tables (on top of Phase 1 schema):

**`app_events`**
```sql
CREATE TABLE IF NOT EXISTS app_events (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    short      TEXT NOT NULL,
    starts_at  TEXT,
    ends_at    TEXT,
    is_active  INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL
);
```

**`event_tournaments`** (event → tournament membership, ordered)
```sql
CREATE TABLE IF NOT EXISTS event_tournaments (
    event_id      TEXT NOT NULL,
    tournament_id TEXT NOT NULL,
    position      INTEGER DEFAULT 0,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (event_id, tournament_id)
);
```

**`event_roles`** (per-event user role overrides)
```sql
CREATE TABLE IF NOT EXISTS event_roles (
    event_id   TEXT NOT NULL,
    username   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user', -- 'user'|'judge'|'admin'
    created_at TEXT NOT NULL,
    PRIMARY KEY (event_id, username)
);
```

**Tournament selector filtering logic:**
- Superadmin/admin (global role): see all active tournaments
- User/judge: see only tournaments in events where they have an `event_roles` row

**PF JWT stays global** — event permissions are local and orthogonal to Supabase access.

**New endpoints:**
- `GET/POST /api/admin/events` — CRUD events (superadmin)
- `POST/DELETE /api/admin/events/<id>/tournaments` — add/remove tournament from event
- `PUT/DELETE /api/admin/events/<id>/roles` — assign/revoke user role for event
- Update `/api/sync`: check user has event access for requested tournament (403 if not)

**Manage tab update:** Redesign to be Events-first.
1. Events list → create/edit/delete event
2. Event detail: add tournaments (selector), assign staff (username + role dropdown)
3. Tournament management as secondary panel

**UI addition:** Event selector above tournament selector in main dashboard. Selecting an event filters tournament dropdown. "(All my tournaments)" as default.

### 2.3 Data Source Provider Layer

**Why:** PurpleFox may integrate with other tournament platforms over time. The provider layer ensures the app can consume whatever PF exposes, or work with Carde-only or Melee.gg as standalone sources.

**Provider interface** in `api_clients.py`:
```python
class TournamentDataProvider:
    def fetch_drops(tid: str) -> list[dict]: ...
    def fetch_penalties(tid: str) -> list[dict]: ...
    def fetch_pairings(tid: str, round_num: int) -> list[dict]: ...
    def fetch_round_timing(tid: str) -> list[dict]: ...
    def fetch_table_status(tid: str) -> list[dict]: ...
    def supports(feature: str) -> bool: ...
    # feature flags: "judge_coverage", "live_timer", "penalties", "drops"
```

**Implementations:**
- `PurpleFoxProvider` — existing Supabase calls
- `CardeProvider` — existing carde.io calls
- `CompositeProvider(providers: list)` — fan-out + merge, per-provider feature detection

**`provider_type` column** (added in Phase 1 `app_tournaments`):
- `'purplefox_carde'` — current behavior (default)
- `'carde_only'` — Carde for timing/pairings; drops/penalties via manual entry
- `'melee_purplefox'` — Melee.gg file import + PurpleFox
- `'melee_only'` — Melee.gg file import only

`fetch_and_store()` refactored:
```python
provider = build_provider(tournament_config["provider_type"], tournament_config)
drops = provider.fetch_drops(tid) if provider.supports("drops") else []
```

**Carde-only mode:** Drops/penalties become manual-entry only. UI conditionally hides judge coverage and table status columns based on `provider.supports("judge_coverage")`.

**Melee.gg:** No public API. Integration via file upload.
- `POST /api/admin/tournaments/<id>/import/melee` — accepts Melee.gg JSON export
- Stores file reference in new `melee_imports` table; reimport on each manual sync
- `MeleeGGProvider` reads from stored import, not real-time

### 2.4 Real-Time Push (SSE)

Replace per-client polling with Server-Sent Events:
- New endpoint: `GET /api/events/stream` — persistent SSE connection per client
- On each `fetch_and_store()` completion: push event to all connected clients
- Client reconnects automatically on disconnect (SSE spec)
- Reduces load: one server-side sync triggers all clients simultaneously
- Keep polling as fallback for clients without SSE support

### 2.5 Manual Entry (from TODO)

- [ ] Manual drop entry UI (form in Logs tab for HJ+ role)
- [ ] Manual penalty entry UI
- [ ] Notes field on drops and penalties (local DB only, never synced back to PF)
- [ ] `POST /api/manual/drops`, `POST /api/manual/penalties`, `PATCH /api/manual/drops/<id>/notes`

### 2.6 Analysis Depth: Round Reports

From TODO.md:
- [ ] Round duration report: actual `started_at` → `completed_at` vs scheduled; flag rounds that ran long
- [ ] Inter-round gap tracking: time between `completed_at` of round N and `started_at` of round N+1
- [ ] Per-user sync state: "synced X seconds ago by hj" in header

**Phase 2 verification:**
- [ ] Superadmin creates event, adds 2 tournaments, assigns a judge — judge sees only those 2 tournaments
- [ ] `/api/sync` returns 403 for tournament outside user's events
- [ ] PostgreSQL backend (prod): all existing syncs work; sessions persist
- [ ] Dev: SQLite still works via `DATABASE_URL=sqlite:///...`
- [ ] Carde-only tournament: judge coverage column hidden in UI
- [ ] Melee.gg import: upload file, sync, round pairings appear

---

## Phase 3 — Depth, Polish, and Infrastructure (Months 4–6, ~180–210 additional hrs)

**Goal:** A tool the whole judge staff wants to use. Production-grade reliability, advanced analytics, mobile usability, and a Docker-based deployment story.

### 3.1 Advanced Analysis (from TODO)

- [ ] Per-table incident heatmap: tables appearing across drops, extensions, judge seats, and penalties → slow play candidates
- [ ] Drop timing analysis: flag drops arriving after round should have ended
- [ ] Judge efficiency report: tables covered per judge, repeat coverage, response time
- [ ] Extension pattern report: average extensions per round → inform future round lengths
- [ ] Cross-tournament event summary: aggregate stats across all tournaments in an event (total drops, penalties, average round time)
- [ ] Event timeline view: visual Gantt of rounds across all tournaments in an event

### 3.2 Export & Reporting

- [ ] Print view / PDF export per round (browser `@media print` stylesheet + print button)
- [ ] CSV export for drops/penalties/pairings (admin only)
- [ ] "What's new since last sync" summary banner at top of Logs tab after each fetch

### 3.3 Notifications

- [ ] Browser push notifications for new drops/penalties during live sync (Web Notifications API — opt-in)
- [ ] Toast system fully in place (Phase 1 groundwork → complete here)

### 3.4 Mobile & Accessibility

- [ ] Mobile-first responsive layout (currently breaks below 800px — rebuild grid for < 480px)
- [ ] Dark mode respect (`prefers-color-scheme` media query)
- [ ] ARIA labels on all interactive elements
- [ ] Reduced motion support
- [ ] Keyboard shortcut layer: `1–8` to switch tabs, `Ctrl+Enter` to sync, `S` to open sync, `Esc` to close modals

### 3.5 Infrastructure & Reliability

- [ ] Docker-compose setup: nginx + app + PostgreSQL (one-command deployment for new events)
- [ ] DB migration runner: version-tracked schema migrations (flat numbered `.sql` files in `migrations/`), replace `PRAGMA table_info()` pattern
- [ ] Graceful shutdown: flush background worker, checkpoint WAL before process exit
- [ ] Connection retry with backoff for Supabase/Carde failures (currently silent); surface error in UI
- [ ] Expanded `/api/health`: last sync time per tournament, background worker status, PF JWT expiry
- [ ] Audit access log table: who viewed what and when (`access_log` table)
- [ ] Pre-event checklist view in Manage tab: `/api/health` all-green + PF JWT valid + tournaments configured

### 3.6 Melee.gg Full Integration

- [ ] Drag-and-drop file upload UI in Manage tab tournament detail
- [ ] Scheduled re-import: re-process last uploaded file on each manual sync press
- [ ] Feature detection UI: show which data columns are available per tournament's provider type
- [ ] Diff view: "these pairings changed since last import"

### 3.7 Future Provider Readiness

`provider_type` column already supports arbitrary new values. Document the `TournamentDataProvider` interface in `AGENT_CONTEXT.md` so new providers can be added by implementing 5 methods. Candidates:
- EventLink (Wizards of the Coast official software)
- Tabletop.to
- Manual-entry only mode (no external source at all)
- Any future PurpleFox-integrated platform

---

## Quality-of-Life Improvements

Day-of-event UX improvements (extension filtering, round-over-round comparison, pace indicators, operator notes, keyboard shortcuts, filter persistence, etc.) are tracked separately in **[QOL_IMPROVEMENTS.md](QOL_IMPROVEMENTS.md)** (same `plans/` folder). Each item there is self-contained and can be shipped independently between events without touching the Phase 1–3 migration work.

Security hardening, developer experience, and operational improvements from the original backlog are listed below for reference and will be folded into the appropriate phase as work progresses.

### Security
- [ ] Remove weak default seeds: `admin/admin` and `hj/hj` should be rejected at seed time with a warning in logs to set real passwords
- [ ] Content-Security-Policy + X-Frame-Options + X-Content-Type-Options headers on all responses
- [ ] HSTS header when behind HTTPS proxy
- [ ] Input sanitization for all admin-writable text fields (tournament names, usernames — already validated, but HTML-escape in responses)
- [ ] Consider 24-hour session expiry for judge-role users (currently 7-day flat)
- [ ] `CARDE_API_TOKEN` rotation process: document in `docs/DEPLOY.md` how to rotate without downtime

### Developer Experience
- [ ] `scripts/check_db.py` → evolve into a DB inspector CLI (`python scripts/check_db.py --table drops --limit 20`)
- [ ] `scripts/test_fetch.py` → expand into an integration test suite against a test DB (`python -m pytest tests/`)
- [ ] `Makefile` or `dev.sh` with common commands: `make start`, `make reset-db`, `make backfill`, `make create-user`
- [ ] `CHANGELOG.md` — document behavior changes between events for non-technical operators
- [ ] Git tag convention: tag each event's deploy (`v2025-05-atlanta`) for easy rollback

### Operational
- [ ] Pre-event checklist: `/api/health` all-green, PF JWT pasted, tournaments configured, test sync succeeds
- [ ] Carde.io rate limit awareness: detect 429s, backoff + notify operator in UI
- [ ] Startup validation: warn loudly if `PF_PASSWORD_PEPPER` is still the default value in prod
- [ ] DB vacuum + analyze scheduled weekly (keep query plans fresh as DB grows)

---

## Implementation Order Summary

| Phase | Duration | Key Deliverables |
|-------|----------|-----------------|
| 1 | Month 1 | DB-backed auth + sessions, tournament/user management UI, code split, static assets, design system foundation, env vars, health endpoint |
| 2 | Months 2–3 | PostgreSQL, event grouping + per-event permissions, provider abstraction, Melee.gg file import, SSE push, manual entry, round analysis |
| 3 | Months 4–6 | Advanced analytics, mobile/a11y, Docker, migration runner, notification system, export/print, full Melee.gg integration |

---

## Critical Files

- `serve.py` → split into `serve.py`, `db.py`, `api_clients.py`, `auth.py`, `routes/` (Phase 1)
- `index.html` → split into `index.html` + `static/css/` + `static/js/` (Phase 1)
- `docs/DEPLOY.md` — add `PF_PASSWORD_PEPPER`, `CARDE_API_TOKEN`, `DATABASE_URL` env vars (Phase 1)
- `agent/AGENT_CONTEXT.md` — update after each phase: new tables, endpoints, modules, provider interface

## Open Decisions Before Phase 2 Starts

1. **psycopg3 install method:** `psycopg[binary]` (recommended) vs `psycopg[c]` (build from source). Binary is easier for deployment; confirm acceptable.
2. **Event model default:** Should existing tournaments automatically get a 1:1 event wrapper, or remain "eventless" until manually grouped? Recommend: eventless by default, group on demand.
3. **Frontend static split:** Confirm single-file pattern can be retired — `serve.py` will need to serve `static/` directory. Any CDN or caching concerns for on-site LAN deployment?
