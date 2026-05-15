# pf-logger — Master Plan

_Consolidated from CURRENT_PLAN.md, QOL_IMPROVEMENTS.md, archive/TODO.md, archive/production-ready.md. Supersedes all of those._

---

## Context

pf-logger is a local-network tournament ops dashboard for Magic/Riftbound/Lorcana events. It pulls from PurpleFox (Supabase) and Carde.io, stores data in SQLite, and presents a real-time dashboard for drops, penalties, time extensions, round timing, and judge activity.

**Current pain points driving this roadmap:**
- Tournaments and users are hardcoded in `serve.py` — adding a new event requires code changes
- Sessions lost on server restart — every restart logs everyone out
- Passwords stored in plaintext
- All backend logic lives in one 1,743-line file; frontend is a 2,575-line single HTML file
- UI was built iteratively — no design system, inconsistent inline styles, small touch targets
- Only supports Carde + PurpleFox together; no way to use either alone or swap platforms
- No event grouping — tournaments exist as flat list, no concept of a "Regional Weekend"
- `missing_tables_json` snapshot is timing-sensitive and currently unreliable — captured at sync time, not at timer expiry
- StageTimer log data (when available) must be processed manually; no import path in the tool

**Budget:** ~3–4 hours/day of human-written code (with AI assistance).

---

## Constraints

| Constraint | Status | Notes |
|---|---|---|
| No external Python deps | **Will change in Phase 2** | Dropping to adopt psycopg3 for PostgreSQL |
| No build step | Retained | Frontend splits into static files but no bundler |
| Single-server deployment | Retained for now | Docker option added in Phase 3 |
| PurpleFox JWT is manual | Retained | Cannot automate; JWT paste in Session tab |

---

## Phase 1 — Productionization + Structure

**Goal:** No more code changes between events. All config from the UI. Codebase split into readable modules. UI gets a first-pass design system. Critical data capture reliability fixed.

### 1.1 Database: Management Tables

Three new tables, all additive — no data loss on existing DB.

**`app_tournaments`** — replaces hardcoded `TOURNAMENTS` dict. Stores PurpleFox UUID, name, short name, carde IDs, provider type, active flag. `is_active=0` is soft-delete (hidden from selector). `is_ended` stays in `tournament_meta` (different semantics).

**`app_users`** — replaces `USERS`/`ADMINS`/`SUPERADMINS` constants. Stores username, hashed password, role (`user`|`admin`|`superadmin`), active flag. Separate from existing `users` table (which is the PurpleFox UUID→name cache).

**`sessions`** — replaces in-memory `_sessions` dict. Persists across restarts. Stores token, username, expiry, IP, user agent. Indexed on expiry for fast cleanup.

**Seed migration** (idempotent `INSERT OR IGNORE` at `db_init()`): seed hardcoded tournaments and users with hashed passwords. Existing data wins on re-run.

### 1.2 Auth Migration

- Hash passwords with `SHA-256(password + PF_PASSWORD_PEPPER)`. Pepper from env var, defaults to a fixed string with a loud warning if unchanged in prod.
- Login reads from `app_users`, compares hash. Rate-limit: 10 attempts per IP per 60s → 429.
- Sessions read/write/delete from `sessions` table instead of `_sessions` dict.
- Add session cleanup at startup and hourly via `threading.Timer`.
- Add helpers: `_hash_password()`, `_get_user_role()`, `_require_admin()`, `_require_superadmin()`, `_cleanup_sessions()`.
- Remove: `_sessions` dict, `USERS`, `ADMINS`, `SUPERADMINS` constants.
- `/api/me` and `/api/login` derive `is_admin`/`is_superadmin` booleans from the role column — frontend API shape unchanged.

### 1.3 Tournament Migration

- Add `_get_tournament_config(tournament_id)` reading from `app_tournaments`.
- Replace all `TOURNAMENTS` references across `/api/tournaments`, `/api/sync`, `/api/end-tournament`, `/api/backfill`.
- Remove hardcoded `TOURNAMENTS` dict.

### 1.4 Admin API Endpoints

New superadmin-gated endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Uptime, DB size, session count, tournament count — no auth |
| GET/POST | `/api/admin/tournaments` | List all (incl. inactive) / Create |
| PATCH/DELETE | `/api/admin/tournaments/<id>` | Edit / Soft-delete |
| GET/POST | `/api/admin/users` | List (no password_hash) / Create |
| PATCH/DELETE | `/api/admin/users/<username>` | Edit role/password/status / Soft-delete + revoke sessions |
| GET | `/api/admin/sessions` | Active sessions |
| DELETE | `/api/admin/sessions/<token>` | Revoke session |
| GET | `/api/admin/backup` | Stream SQLite file after WAL checkpoint |
| GET/PATCH | `/api/admin/config` | Read/set app-level config (default refresh interval, etc.) |

**Guards:** Superadmin cannot deactivate own account. Deactivating a user immediately deletes all their sessions. `end-tournament` and `backfill` restricted to admin+.

**Validation:** username `^[a-z0-9_-]{3,32}$`, password 6–128 chars, role enum, carde IDs positive int if provided, name/short non-empty max 128 stripped.

**Audit logging** via `db_log_activity()`: `tournament_created`, `tournament_updated`, `tournament_deactivated`, `user_created`, `user_updated`, `user_deactivated`, `session_revoked`, `login_failed`, `db_backup_downloaded`.

### 1.5 Code Compartmentalization

Split `serve.py` into sibling modules — no external deps, stdlib only:

```
serve.py          — main Handler, do_GET/do_POST dispatch, entry point (~200 lines)
db.py             — all db_* functions, db_init(), db_connect(), schema
api_clients.py    — Supabase/Carde fetchers, _carde_worker(), fetch_and_store()
auth.py           — _require_auth(), session helpers, JWT decode, rate limiting
routes/
  tournaments.py  — /api/tournaments, /api/sync, /api/logs, /api/backfill, /api/end-tournament
  admin.py        — /api/admin/* endpoints
  session.py      — /api/login, /api/logout, /api/me, /api/set-token, /api/token-status
```

### 1.6 Frontend: Static File Split + Design System Foundation

Split `index.html` into static assets served via a new `GET /static/<file>` route:

```
index.html             — master shell only (~200 lines)
static/css/
  theme.css            — CSS variables (colors, spacing, radius, typography)
  layout.css           — grid, flex, structure
  components.css       — buttons, panels, badges, tables, modals
static/js/
  api.js               — apiFetch(), sync, proxy
  auth.js              — login, token, session state, applyAdminVisibility()
  ui.js                — tabs, renderAll(), renderRoundBlock(), filters
  insights.js          — renderInsights(), renderInfractions(), stats
```

Design system additions: semantic color tokens (`--urgent`, `--success`, `--warning`, `--info`), spacing scale, radius tokens. Remove all recurring inline `style=` attributes and replace with CSS classes.

**UX improvements:** Sticky action bar (Fetch/Sync always in viewport), larger status indicators (min 44px touch targets), toast notifications for sync events, tab badges with urgency treatment, more prominent countdown timer.

### 1.7 Manage Tab (Superadmin-only)

New tab with three lazy-loaded panels:

1. **Tournaments** — list with Edit/Deactivate, Add form (name, short, PF UUID, carde IDs, provider type). Ended tournaments sorted to bottom of selector.
2. **Users** — table with color-coded role badge, inline role edit, Reset Password, Deactivate/Reactivate. Create form. Own row buttons disabled.
3. **Sessions** — active sessions with IP and expiry, Revoke button per row.

Other: Gate "End event" button to superadmin only. Improve Session tab JWT extraction instructions (step-by-step DevTools guide).

### 1.8 Env Var + Operational Cleanup

- `CARDE_API_TOKEN` → `os.environ.get("CARDE_API_TOKEN")`
- `PF_PASSWORD_PEPPER` → env var, warn loudly at startup if still default value
- Both added to systemd `Environment=` in `DEPLOY.md`
- Auto-backfill thread at startup — cheap, ensures timing data always fresh on restart
- Structured logging: `RotatingFileHandler` to replace stdout-only logging
- Remove weak default seeds: `admin/admin` and `hj/hj` should fail at seed time with a log warning to set real passwords

### 1.9 Timer-Triggered Sync (High Priority — Data Reliability)

_New item from post-event analysis. Currently the most important reliability gap._

The `missing_tables_json` snapshot is only accurate if a sync happens at the exact moment the round clock expires. A sync triggered a few minutes later (after some results come in) produces an incomplete or empty snapshot, making outstanding-table data unreliable.

- Detect when `timer_end_datetime` has passed during an active sync cycle
- Trigger an immediate targeted pairings fetch for that round when it transitions from ACTIVE to expired
- This is the mechanism that produces a reliable `missing_tables_json` — not a full sync, just the round's match list
- Pairs with capturing per-match `updated_at` at the same moment (see 1.10)

### 1.10 Per-Match `updated_at` Snapshot at Round End

_New item from post-event analysis._

When a round clock expires, fetch and store the `updated_at` for all matches in that round. This allows post-event reconstruction of:
- Which tables finished after the timer (outstanding at end)
- How far over time each outstanding table ran
- Cross-reference with `time_logs` to distinguish extended vs. genuinely late tables

Store in a new `round_match_snapshots` table or as an extension of `round_pairings`. Design TBD.

**Phase 1 verification checklist:**
- Sessions survive server restart
- Superadmin creates tournament from UI → appears in selector immediately
- New user can log in with created password
- Admin cannot reach `/api/admin/users` (403)
- Rate limit fires at 11th login attempt from same IP (429)
- All existing sync/log/backfill flows work unchanged
- `missing_tables_json` captured at timer expiry on a live round, not at next manual sync

---

## Phase 2 — PostgreSQL, Events, and Provider Layer

**Goal:** Multi-event management, per-event permissions, real database for production, and the abstraction layer that allows new tournament platforms to be plugged in.

### 2.1 PostgreSQL Migration

Accept `psycopg3` (`psycopg[binary]`) as the first external dependency. Drop the zero-deps constraint.

`DATABASE_URL` env var controls backend:
- `DATABASE_URL=sqlite:///action_logs.db` → sqlite3 (dev default)
- `DATABASE_URL=postgresql://user:pass@host/db` → psycopg3 (prod)

`db.py`'s `db_connect()` selects driver from the prefix. Key syntax changes needed: `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`, `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE`, `PRAGMA table_info` → `information_schema.columns`, remove WAL pragma, `AUTOINCREMENT` → `SERIAL`. All `ON CONFLICT DO UPDATE SET` / COALESCE write-once patterns are syntax-identical in PostgreSQL — no changes needed there.

Connection pooling via `psycopg.pool.SimpleConnectionPool(min=2, max=8)`.

### 2.2 Event Grouping + Per-Event Permissions

Three new tables: `app_events` (id, name, short, starts_at, ends_at, is_active), `event_tournaments` (event → tournament membership with ordering), `event_roles` (per-event role overrides per user).

Tournament selector filters by event membership for non-admin users. Superadmin/admin see all. PF JWT stays global — event permissions are local and orthogonal.

New endpoints for event CRUD, tournament assignment, and staff role assignment (all superadmin).

Manage tab redesigned to be Events-first: event list → event detail with tournament list and staff assignments → tournament management as secondary panel.

UI: event selector above tournament selector; "(All my tournaments)" default.

### 2.3 Data Source Provider Layer

Abstract `fetch_and_store()` behind a `TournamentDataProvider` interface with methods: `fetch_drops`, `fetch_penalties`, `fetch_pairings`, `fetch_round_timing`, `fetch_table_status`, `supports(feature)`.

Implementations: `PurpleFoxProvider` (existing Supabase calls), `CardeProvider` (existing Carde calls), `CompositeProvider` (fan-out + merge).

`provider_type` column (added in Phase 1 `app_tournaments`) drives which implementation is used:
- `purplefox_carde` — current behavior (default)
- `carde_only` — Carde for timing/pairings; drops/penalties manual-entry only
- `melee_purplefox` — Melee.gg file import + PurpleFox
- `melee_only` — Melee.gg file import only

UI conditionally hides columns based on `provider.supports()` feature flags (e.g. no judge coverage column in carde-only mode).

### 2.4 Real-Time Push (SSE)

Replace per-client polling with Server-Sent Events. New `GET /api/events/stream` endpoint maintains persistent SSE connection per client. Each `fetch_and_store()` completion pushes to all connected clients simultaneously. Keep polling as fallback.

### 2.5 Manual Entry

Manual drop and penalty entry from the UI (form in Logs tab, HJ+ role). Notes field on drops and penalties (local DB only, never synced back to PurpleFox). New endpoints: `POST /api/manual/drops`, `POST /api/manual/penalties`, `PATCH /api/manual/drops/<id>/notes`.

### 2.6 Round Timing Analysis

- Round duration report: time from `started_at` → actual round end, vs. scheduled. **Note: `completed_at` is NOT usable as "round end" for Swiss rounds — it equals the next round's `started_at`. Use `timer_end_datetime` as a proxy for scheduled end. For actual end (last result entered), use per-match `updated_at` data from 1.10 snapshot or, where available, StageTimer log data. This needs more thought before implementation.**
- Inter-round gap: time between round N's actual end and round N+1's `started_at`
- Per-user sync state: "synced X seconds ago by hj" in header

### 2.7 StageTimer Log Import

_New item from post-event analysis._

StageTimer is an optional broadcast timer used at some events. Its logs (UTC timestamped text files) are currently processed manually for post-event analysis. Add a first-class import path:

- Upload interface in Manage tab (tournament detail)
- Parser for StageTimer log format: extract start, stop, reset events per round; identify actual round clock starts and stops
- Store parsed data in a new `stagetimer_logs` table linked to `tournament_id` and `round`
- Use imported data in Insights tab to populate actual timer start/stop times where available
- Timezone handling: StageTimer logs are UTC; must convert to event's local timezone at import time (timezone configurable per tournament)
- Partial coverage: import only covers tables the timer was deployed for — UI should note this

**Phase 2 verification:**
- Superadmin creates event, adds 2 tournaments, assigns a judge — judge sees only those 2 tournaments
- `/api/sync` returns 403 for tournament outside user's events
- PostgreSQL backend: all existing syncs work; sessions persist
- Dev: SQLite still works
- Carde-only tournament: judge coverage column hidden
- Melee.gg import: upload file, sync, round pairings appear
- StageTimer import: upload log file, round start/stop times appear in Insights

---

## Phase 3 — Depth, Polish, and Infrastructure

**Goal:** Production-grade reliability, advanced analytics, mobile usability, Docker deployment.

### 3.1 Advanced Analysis

- Per-table incident heatmap: tables appearing across drops, extensions, judge seats, and penalties → slow play candidates
- Drop timing analysis: flag drops arriving after round should have ended
- Judge efficiency report: tables covered per judge, repeat coverage, response time
- Extension pattern report: average extensions per round → inform future round lengths
- Cross-tournament event summary: aggregate stats across all tournaments in an event
- Event timeline view: visual Gantt of rounds across all tournaments in an event
- Standings generation timestamp investigation: determine if Carde's standings endpoint returns a `generated_at` field and if so, capture it as a proxy for pairings published time

### 3.2 Export & Reporting

- Print view / PDF export per round (`@media print` + print button)
- CSV export for drops/penalties/pairings (admin only)
- "What's new since last sync" summary banner

### 3.3 Notifications

- Browser push notifications for new drops/penalties during live sync (Web Notifications API, opt-in)
- Toast system fully in place (Phase 1 groundwork → complete here)

### 3.4 Mobile & Accessibility

- Mobile-first responsive layout (currently breaks below 800px — rebuild for <480px)
- Dark mode (`prefers-color-scheme`)
- ARIA labels on all interactive elements
- Reduced motion support
- Keyboard shortcut layer: `1–8` to switch tabs, `Ctrl+Enter` to sync, `F` for search focus, `Esc` to blur

### 3.5 Infrastructure & Reliability

- Docker-compose: nginx + app + PostgreSQL (one-command deployment)
- DB migration runner: version-tracked numbered `.sql` files in `migrations/`, replaces `PRAGMA table_info()` pattern
- Graceful shutdown: flush background worker, checkpoint WAL before exit
- Connection retry with backoff for Supabase/Carde failures; surface errors in UI
- Expanded `/api/health`: last sync time per tournament, background worker status, PF JWT expiry
- Audit access log table: who viewed what and when
- Pre-event checklist in Manage tab: health all-green + PF JWT valid + tournaments configured + test sync succeeds
- `CARDE_API_TOKEN` rotation process documented in `DEPLOY.md`
- DB vacuum + analyze scheduled weekly
- `scripts/check_db.py` evolved into a proper CLI inspector
- `scripts/test_fetch.py` evolved into an integration test suite
- `Makefile` with common commands: `make start`, `make reset-db`, `make backfill`, `make create-user`
- `CHANGELOG.md` for non-technical operators
- Git tag convention: tag each event's deploy (e.g. `v2026-05-atlanta`) for easy rollback

### 3.6 Melee.gg Full Integration

- Drag-and-drop file upload in Manage tab tournament detail
- Scheduled re-import: re-process last uploaded file on each manual sync
- Feature detection UI: show which columns are available per provider type
- Diff view: "these pairings changed since last import"

### 3.7 Partial Venue Coverage UI

_New item from post-event analysis._

On large events, PurpleFox and StageTimer only cover a section of the venue. The tool should make this transparent:

- Per-tournament config: store `managed_tables_min` and `managed_tables_max` (or a list of managed table ranges)
- In Insights tab, note when outstanding-table counts and extension data only reflect a subset of the full event
- Flag in the round timing view when StageTimer coverage is partial vs. full

### 3.8 Future Provider Readiness

`provider_type` column already supports arbitrary new values. Document the `TournamentDataProvider` interface in `AGENT_CONTEXT.md`. Candidates: EventLink (WotC), Tabletop.to, manual-entry-only mode.

---

## QoL Improvements

Day-of-event UX improvements. Each item is self-contained and can be shipped independently between events without touching the Phase 1–3 migration work unless noted.

**Dependency note:** QoL 2, 4, and 10 rely on QoL 1 (logistics filtering). QoL 9 benefits from QoL 6 (operator notes). All others are standalone.

---

### QoL 1 — Extension Logistics Filtering

Large extensions (e.g. 55+ minutes) are not judge responses — they're the TO pausing the clock for lunch, late starts, or early-round adjustments. These should be excluded from all Insights metrics (averages, counts, longest extension) without deleting them from the DB.

Add a configurable `EXTENSION_LOGISTICS_THRESHOLD_MIN` constant (default 50). Tag logistics extensions during rendering rather than at the data layer. Show a dimmed note below the extension table: "N extensions > 50 min excluded (logistics)." Raw values remain visible in the Data tab.

### QoL 2 — Round-Over-Round Comparison

Side-by-side stat panel in Insights tab for any two rounds. Shows extensions, drops, penalties, outstanding tables, and round duration for each, with a delta column (▲/▼ color-coded).

**⚠️ Duration calculation needs more thought.** Current spec uses `started_at → completed_at`, which is incorrect for Swiss rounds (`completed_at` = next `started_at`). Duration should use actual round end data — either from the Phase 1.10 match snapshot or StageTimer import (Phase 2.7). Implement after those are in place or define a fallback.

Depends on QoL 1 (logistics filtering applied to extension count).

### QoL 3 — Round Pace Indicator

Badge on each active round block in Insights showing "on track / Xm over / significantly over" based on elapsed time vs. `timer_end_datetime`. Shows a red alert banner when a round is >15 minutes past time called. No badge for completed rounds or Top-8 rounds (no `timer_end_datetime`).

### QoL 4 — Extension Distribution Histogram

Small bar chart inside each round block showing extension lengths bucketed in 5-minute increments. Renders only when a round has 2+ extensions. Logistics extensions excluded.

Depends on QoL 1.

### QoL 5 — "New Since Last Sync" Tab Badge

After each successful live sync, show a count badge on the Logs tab indicating how many entries are new. Clears when the user switches to the Logs tab. Reuses existing `.tab-badge` CSS.

### QoL 6 — Operator Notes Per Round

Let the head judge attach a short freeform note to any round (e.g. "deck check pile-up at tables 12–15"). Notes live only in SQLite (`round_timers.operator_notes`), never synced to PurpleFox. Visible in Insights, editable inline by admin-role users. Requires a DB migration (`ALTER TABLE round_timers ADD COLUMN operator_notes TEXT`) and a new `PATCH /api/round-notes` endpoint (admin-gated).

### QoL 7 — Collapsible Round Blocks in Logs Tab

Group the Logs feed by round with collapsible headers. Default: highest-numbered round expanded, all others collapsed. Open/collapsed state preserved through auto-refresh cycles. Reuses the existing `.section`/`.section-header`/`.section-body` collapsible pattern from Insights.

### QoL 8 — Quick Filter Presets

One-click buttons above the filter bar for common filter combinations: "This round", "Extensions only", "Drops only", "Penalties only", "Clear". Active preset gets a highlighted border. Presets do not persist across page loads — they're a quick jump, not a saved state.

### QoL 9 — Copy-to-Clipboard Round Summary

"Copy" button in each round header in Insights. Produces a paste-ready plain-text summary (tournament name, round, timer range, drops, extensions, penalties, operator notes if set) for posting in Discord or Slack. Falls back to `alert()` on non-HTTPS. Clicking "Copy" does not toggle the round section.

Logistics extensions excluded. Benefits from QoL 6 (notes in output).

### QoL 10 — Trend View (All-Rounds Overview Table)

Compact table at the top of Insights showing drops, extensions, penalties, outstanding tables, and round duration for every round in one view. Renders when 2+ rounds of data are available. Cells with value 0 show as "—" to reduce noise.

**⚠️ Duration calculation needs more thought.** Same issue as QoL 2. Implement after Phase 1.10 or Phase 2.7 provides reliable round end data.

Depends on QoL 1.

### QoL 11 — Keyboard Shortcuts

Keyboard navigation for power users: `1–8` to switch tabs, `Ctrl+Enter` to trigger sync, `F` to focus search and jump to Logs, `Esc` to blur inputs. Keys suppressed when focus is in an input/textarea/select. Shortcuts documented in Guide tab.

### QoL 12 — Filter and Sort State Persistence

Preserve round filter, type filter, search text, highlight-new toggle, and refresh interval across tab switches and page refreshes using `localStorage`. On restore, fall back gracefully if a saved round no longer exists in the current tournament.

### QoL 13 — "What Changed Since Last Sync" Diff Banner

After each live sync (not cache loads), show a collapsible banner in the Logs tab listing new drops, extensions, and penalties by count since the previous load. Suppressed on first (cold) load. Dismiss button hides until next sync with changes.

---

## Open Decisions

1. **psycopg3 install method**: `psycopg[binary]` (recommended, easier deployment) vs `psycopg[c]` (build from source). Confirm acceptable before Phase 2 starts.
2. **Event model default**: Should existing tournaments automatically get a 1:1 event wrapper, or remain eventless until manually grouped? Recommendation: eventless by default.
3. **Frontend static split**: Confirm single-file pattern can be retired and `serve.py` will serve `static/`. Any caching concerns for on-site LAN deployment?
4. **Round duration source of truth**: For QoL 2, QoL 10, and Phase 2.6 — confirm whether Phase 1.10 (`updated_at` snapshot) or Phase 2.7 (StageTimer import) is the primary source, and what to show when neither is available.
5. **StageTimer timezone config**: Should timezone be per-tournament config, inferred from carde `started_at` offset, or manually entered at import time?
6. **`round_match_snapshots` table design (Phase 1.10)**: separate table or extend `round_pairings` with a `snapshot_taken_at` column?

---

## Implementation Order Summary

| Phase | Key Deliverables |
|-------|-----------------|
| 1 | DB-backed auth + sessions, tournament/user management UI, code split, static assets, design system foundation, env vars, health endpoint, timer-triggered sync (1.9), match snapshot at round end (1.10) |
| 2 | PostgreSQL, event grouping + per-event permissions, provider abstraction, Melee.gg file import, SSE push, manual entry, round analysis, StageTimer import (2.7) |
| 3 | Advanced analytics, mobile/a11y, Docker, migration runner, notification system, export/print, full Melee.gg integration, partial coverage UI (3.7) |
| QoL | Independent of phases — ship any item between events in a focused 1–3 hr session |

**Suggested QoL order (lowest to highest effort, no dependencies first):**
QoL 1 → QoL 5 → QoL 8 → QoL 11 → QoL 12 → QoL 3 → QoL 13 → QoL 7 → QoL 6 → QoL 9 → QoL 2\* → QoL 10\* → QoL 4

_\* Blocked on duration calculation decision (Open Decision #4)_

---

## Critical Files

- `serve.py` → split into `serve.py`, `db.py`, `api_clients.py`, `auth.py`, `routes/` (Phase 1)
- `index.html` → split into `index.html` + `static/css/` + `static/js/` (Phase 1)
- `docs/DEPLOY.md` — add `PF_PASSWORD_PEPPER`, `CARDE_API_TOKEN`, `DATABASE_URL` env vars (Phase 1)
- `agent/AGENT_CONTEXT.md` — update after each phase: new tables, endpoints, modules, provider interface
