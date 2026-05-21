# Agent Context — PurpleFox Action Log Exporter

Everything an agent needs to work on this codebase without re-deriving it from scratch.

---

## What this is

A local-network web tool for tournament administrators running Magic/Riftbound/Lorcana events.
Pulls from Carde.io and optionally PurpleFox (Supabase-backed), stores in PostgreSQL, serves a real-time dashboard for drops, extensions, penalties, round timing, and judge activity.

**Stack: TypeScript + Express + Prisma + PostgreSQL backend. React 18 + Vite frontend.**
Runs with `npm run dev` (dev) or `npm start` (production).

> The sections below covering `serve.py`, SQLite, and the Python architecture are **legacy reference only**. The rewrite plan is in `plans/phase-0.md`. New API contract is in `plans/phase-0.md` § P0.5. Confirmed API behavior is in `agent/CARDE_IO.md` and `agent/PURPLEFOX.md`.

---

## File structure

```
serve.py                      — Single-file Python HTTP server (stdlib only). All routes, DB logic, and external API calls.
index.html                    — Single-file frontend (HTML + CSS + vanilla JS). No framework, no bundler.
action_logs.db                — SQLite database. Created automatically on first run. Never commit this.
scripts/check_db.py           — DB inspection utility (row counts, sample rows).
scripts/test_fetch.py         — Manual integration test script.
docs/DEPLOY.md                — VPS deployment guide (nginx + certbot + systemd).
docs/USER_GUIDE.md            — Non-technical user documentation.
docs/api-exploration-lessons-learned.md - Technical analysis stemming from a post-event data gathering process.
agent/AGENT_CONTEXT.md        — This file.
plans/CURRENT_PLAN.md         — Three-phase roadmap.
plans/QOL_IMPROVEMENTS.md     — Day-of-event quality-of-life improvement queue.
plans/archive/TODO.md         — Original improvement backlog (superseded).
plans/archive/production-ready.md — Earlier productionization plan (superseded).
```

---

## Architecture

```
Browser
  └── index.html (all JS inline)
        ├── apiFetch() — adds Bearer token, handles 401
        ├── /api/* calls → serve.py
        └── /proxy?url= → serve.py → Supabase (requires PF JWT)

serve.py (ThreadingTCPServer on port 8765)
  ├── Local auth: USERS/ADMINS/_sessions (in-memory, no DB)
  ├── PurpleFox JWT: _state["token"] (in-memory, no DB)
  ├── fetch_and_store() — Supabase + carde.io → SQLite
  ├── _carde_worker() — background thread, pairings fetch
  └── action_logs.db (SQLite, same directory)

Data sources:
  ├── Carde.io API — pairings, results, round timing, standings (always present)
  ├── PurpleFox / Supabase — drops, extensions, penalties, judge activity (requires JWT)
  └── StageTimer — broadcast timer logs (optional, manual import, post-event only)
```

Two completely separate auth layers:
- **Local auth** (`Bearer <token>`): our own users (admin/hj). Required for all Carde.io API routes except `/api/login`. Sessions live in `_sessions` dict, expire after 7 days.
- **PurpleFox JWT**: a Supabase JWT from a logged-in PF user. Required only for `/api/sync` and `/proxy`. Stored in `_state["token"]` in-memory.

**StageTimer** is an optional third-party broadcast timer used at some events to display the round clock to players. It is not integrated into the live sync — its logs (exported as text files, timestamped in UTC) are used manually for post-event analysis only. Not all events use StageTimer; within a multi-tournament convention, individual tournaments may or may not have a timer screen. When StageTimer data is available, it provides more accurate round start/end times than Carde.io alone (which only gives `started_at`, not actual clock stop time).

---

## serve.py — key constants and state

```python
PORT = 8765
DB_PATH = os.path.join(DIRECTORY, "action_logs.db")
SUPABASE_BASE = "https://upbcarvmkmyzhbosheyo.supabase.co/rest/v1"
CARDE_API_TOKEN = "ca05adef010f23d3eed5e56900f4959100681077"
SUPABASE_ANON_KEY = "eyJ..."   # anon key, not a secret

TOURNAMENTS = {
    "4ac50cb1-f6ad-4507-94a1-6aee88b2cb7e": {
        "name": "Atlanta Regional Qualifier",
        "short": "Regional Qualifier",
        "carde_event_id": 502327,
        "carde_base_round_id": 721201,   # first round ID is base + 1
    },
    "17ed5ad8-0c94-41f9-bb22-2ec85453eeb2": {
        "name": "Regional Rebound",
        "short": "Regional Rebound",
        "carde_event_id": 513852,
        "carde_base_round_id": 727668,
    },
}

USERS = {"admin": "admin", "hj": "hj"}   # plaintext passwords
ADMINS = {"admin"}                         # subset of USERS with is_admin=true
_sessions = {}                             # token_hex(16) → {username, exp}

_state = {
    "token": None,          # PF JWT (Supabase)
    "token_set_at": None,
    "token_set_by": None,   # IP address
    "token_exp": None,      # unix timestamp
    "token_email": None,
}

_carde_lock = threading.Lock()
_carde_running = set()      # tournament_ids currently being bg-fetched
```

---

## API routes (TypeScript / Express — current target)

> Full contract with request/response shapes in `plans/phase-0.md` § P0.5. Summary below.

**Auth:** `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`

**PF Session (JWT):** JWT is never stored in DB or `.env` — only in memory (`jwtStore.ts`). Metadata (`expires_at`, `set_by`) persisted to `pf_session` table (singleton row).
- `POST /api/session/pf-jwt` (admin+) — paste JWT; validates, stores in memory, writes metadata
- `GET /api/session/pf-jwt` — `{ status, expiresAt, setBy, inMemory }` — `inMemory: false` means re-paste needed after restart
- `DELETE /api/session/pf-jwt` (admin+) — clear stored JWT

**Tournaments:** `GET /api/tournaments` · `GET /api/tournaments/:id` · `POST /api/tournaments/:id/sync` · `POST /api/tournaments/:id/end`

**Data (per tournament):** `GET /api/tournaments/:id/rounds` · `/drops` · `/extensions` · `/penalties` · `/coverage` · `/judge-calls` · `/summary`

**Drop check-off:** `PATCH /api/tournaments/:id/drops/:dropId` — `{ isChecked: boolean }`

**Worker:** `GET /api/worker-status` — `{ isRunning, lastSyncAt, currentRound, lastError }` per tournament

**System:** `GET /api/health` (no auth) · `GET /api/data?table=&limit=&offset=` (admin+)

**Admin (superadmin):** `/api/admin/tournaments` · `/api/admin/users` · `/api/admin/sessions` · `/api/admin/backup` — see `plans/phase-1.md` § 1.1 for full spec.

---

## Legacy: serve.py — all API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/login` | none | Returns `{ok, token, username, is_admin}`. |
| GET | `/api/logout` | Bearer | Removes token from `_sessions`. |
| GET | `/api/me` | Bearer | Returns `{username, is_admin}`. |
| GET | `/api/tournaments` | Bearer | Returns list from `TOURNAMENTS` + `is_ended` from DB. |
| GET | `/api/logs?tournamentId=` | Bearer | Reads all tables from SQLite, returns full dataset. |
| GET | `/api/sync?tournamentId=` | Bearer + PF JWT | Calls `fetch_and_store()`, returns full dataset. |
| GET | `/api/backfill[?tournamentId=]` | Bearer | Re-fetches carde.io round data. |
| GET | `/api/table-data?table=&limit=&offset=` | Bearer + admin | Raw SQLite table explorer. |
| GET | `/api/end-tournament?tournamentId=` | Bearer | Sets `is_ended=1`. |
| POST | `/api/set-token` | Bearer | Stores PF JWT in `_state`. |
| GET | `/api/token-status` | Bearer | Returns status/expiry of stored PF JWT. |
| GET | `/proxy?url=` | Bearer + PF JWT | Authenticated proxy to Supabase. |

---

## serve.py — fetch_and_store(tournament_id)

The core sync function. Called by `/api/sync`. Sequence:

1. Fetch from Supabase (9 tables via `safe_supabase_get()`):
   - `tournament_drops`, `tournament_logs`, `tournament_penalities` (note typo in PF schema), `table_status`, `tables` (coveredBy), `tables` (judgeResult), `tournaments`, `tournament_time`, `players`, plus global drops for user-name seeding.
2. Transform rows to match local schema (camelCase → snake_case, booleans → 0/1, etc.).
3. Upsert into SQLite (all writes in a single `db_connect()` context).
4. Call `fetch_carde_all_rounds(event_id)` and `fetch_carde_tournament_overview(event_id)`.
5. Upsert round timing into `round_timers`.
6. Determine which rounds need pairing fetches (new rounds, status transitions to COMPLETE, snapshot needed).
7. If rounds need fetching and no bg worker is running: start `_carde_worker()` in a daemon thread.
8. Re-read full accumulated history from SQLite and return as a dict.

Returns: `{drops, time_logs, penalties, time_updates, coverage, judge_results, tournament_info, table_players, round_pairings, round_timers, live_status, fetched}`.

---

## serve.py — background carde worker

`_carde_worker(tournament_id, rounds_to_fetch)` runs in a daemon thread.

- Fetches paginated matches for each round via `fetch_carde_pairings(round_num, carde_round_id)`.
- Upserts into `round_pairings` and `rounds_fetched`.
- For COMPLETE rounds: counts missing results and writes `incomplete_at_end`.
- For snapshot rounds: writes `missing_tables_json` (tables without results at time-called).
- Uses `_carde_lock` + `_carde_running` set to prevent duplicate concurrent runs per tournament.

---

## serve.py — DB upsert conventions

**Critical rule: never use `INSERT OR REPLACE`.** It deletes + re-inserts the row, resetting columns not in the INSERT list (including `is_ended`). Always use:

```sql
INSERT INTO table (...) VALUES (...)
ON CONFLICT(...) DO UPDATE SET
  col = excluded.col,
  nullable_col = COALESCE(excluded.nullable_col, table.nullable_col)
```

COALESCE write-once semantics: once a non-null value is stored, a later upsert with NULL won't overwrite it. Used on: `started_at`, `completed_at`, `timer_duration_minutes`, `timer_end_datetime`, `extra_time_seconds`, `incomplete_at_end`, `missing_tables_json`.

Exceptions where `INSERT OR REPLACE` is intentional: `users`, `time_logs`, `penalties`, `round_pairings`, `table_players` (always reflect latest state, no write-once fields).

---

## serve.py — DB migrations

New columns are added at the bottom of `db_init()` using `PRAGMA table_info()` + `ALTER TABLE ADD COLUMN`. Pattern:

```python
cols = [r[1] for r in conn.execute("PRAGMA table_info(table_name)").fetchall()]
if "new_col" not in cols:
    conn.execute("ALTER TABLE table_name ADD COLUMN new_col TYPE")
```

The `CREATE TABLE IF NOT EXISTS` block in `db_init()` only runs on a fresh DB. For existing DBs, the migration block below it handles new columns.

---

## SQLite schema — all tables

### drops
Primary source: `tournament_drops` Supabase table (not `drops` — that returns 404).
PK: `(tournament_id, player_game_id, round)`.
Key cols: `is_checked`, `is_cancelled`, `added_by_name` (stamped on first unchecked insert — local concept only, PF only has `updated_by_name`), `verified_by_name` (stamped when `is_checked` transitions to 1 — local concept only). Three-pass upsert: INSERT OR IGNORE → UPDATE unchecked → UPDATE checked.
Note: PF `tournament_drops` has no `createdAt` — no timestamp available for sorting.

### time_logs
Source: `tournament_logs`. Contains only judge time-extension log entries ("Change time from Xmin to Ymin"). PK: `id` (Supabase int). `INSERT OR REPLACE`.

### penalties
Source: `tournament_penalities` (typo in PF schema, must match exactly). PK: `id`. `INSERT OR REPLACE`.

### table_time_updates
Source: `table_status`. One row per `(tournament_id, table_number, updated_at)` timestamp — each status change is a distinct event. `INSERT OR IGNORE` (timestamp uniqueness).

### table_coverage
Source: `tables.coveredBy`. One row per `(tournament_id, table_number, covered_by)`. `INSERT OR IGNORE` — records first time we see a judge at a table.

### table_judge_results
Source: `tables.judgeResult`. One row per `(tournament_id, table_number, judge_result)`. `INSERT OR IGNORE`.

### tournament_meta
One row per tournament. Cols: `tournament_id`, `last_table`, `default_time`, `name`, `updated_at`, `is_ended`. `is_ended` is only written by `/api/end-tournament` and must never be reset by a sync — this is why the upsert only updates the four listed columns.

### table_players
Source: `players`. One row per `(tournament_id, table_number, player_game_id)`. `INSERT OR REPLACE`.

### round_pairings
Source: carde.io matches-list. One row per `(tournament_id, round, table_number)`. Cols include `p1_name`, `p1_user_id`, `p2_name`, `p2_user_id`, `status`, `time_extension_sec`, `winner_user_id`. `INSERT OR REPLACE`.

### rounds_fetched
Tracks which rounds have been fetched from carde.io. PK: `(tournament_id, round)`. Cols: `fetched_at`, `match_count`, `carde_round_id`, `carde_status`. Used by `fetch_and_store` to decide what needs (re)fetching.

### round_timers
One row per `(tournament_id, round)`. Primary timing record. Key cols:
- `carde_round_id` — used for pairings API calls
- `started_at` — when TO started the clock (from Carde `get_all_rounds`)
- `timer_end_datetime` — computed: `started_at + timer_duration_minutes * 60`. Note: Carde does expose this on `detail/` but compute locally for reliability (+7–83s server lag). NULL for Top-8 rounds.
- `completed_at` — stored verbatim from Carde; equals next round's `started_at` for Swiss; never use for duration
- `timer_duration_minutes` — set when TO configures the round timer via `edit_current_round_timer`; NULL for Top-8 and until timer is set
- `carde_status` — `UPCOMING` | `IN_PROGRESS` | `COMPLETE` (no ACTIVE, no SCHEDULED)
- `incomplete_at_end` — number of tables without results at moment timer hit zero
- `missing_tables_json` — JSON array of table numbers outstanding at snapshot time
Note: there is no round-level extra time field in Carde. Round timer adjustments are reflected only in `timer_end_datetime` on the Carde `detail/` endpoint, not in any round object field.

### users
Name cache: `(user_id TEXT PK, display_name TEXT)`. Seeded from drops, penalties, global drops, and JWT metadata. Used to resolve UUID → display name via `db_resolve_name()`.

---

## Supabase / PurpleFox notes

- Column names are camelCase in PurpleFox schema (`tournamentId`, `tableNumber`, etc.).
- Filter key is `tournamentId` not `tournament_id`.
- `tournament_penalities` has a typo — the extra 'i' is in the actual PF schema. Correct spelling returns 404.
- `tournament_logs` only contains time-extension entries (despite the name — not a general log). Has a `round` column.
- `tournament_drops` is the real table name — `drops` returns 404.
- `tables` and `table_status` and `tournament_time` are **current-round-only**: wiped on every round advance. Never treat an empty response as "no activity."
- Coverage and judge results are both on the PF `tables` table (`coveredBy`, `judgeResult` columns) — `table_coverage` and `table_judge_results` do not exist.
- `judgeResult` on PF `tables` is a free-text string, not an enum.
- `tournament_drops` has no `createdAt` — cannot sort drops by time.
- `tournament_penalities.createdAt` has no timezone suffix — treat as UTC.
- `tournament_logs.createdAt` has `+00:00` suffix — UTC confirmed.
- PF `defaultTime` on tournaments is in **seconds** (3000 = 50 min).
- `profiles` is the staff identity table (`id`, `firstname`, `lastname`). `users` returns 404.
- JWT validity is ~48h (Discord OAuth). No refresh token — re-login required when expired.

---

## Carde.io API

Base: `https://api.admin.carde.io`. Auth: `Authorization: Token {CARDE_API_TOKEN}`.
Full reference: `docs/carde-api.md`. Full behavioral notes: `agent/CARDE_IO.md`.

### GET /api/magic-events/{event_id}/get_all_rounds/
Returns array of phase objects. Each phase has `rounds: []`. Key round fields: `id`, `round_number`, `status` (`UPCOMING`|`IN_PROGRESS`|`COMPLETE`), `started_at`, `completed_at`, `timer_duration_minutes` (null until timer set), `pairings_status`, `standings_status`. **No `extra_time_seconds` or `additional_time_seconds` — these fields do not exist on round objects. No `timer_end_datetime` on round objects.**

### GET /api/magic-events/{event_id}/tournament_overview/
Live snapshot. Key fields: `lifecycle_status`, `number_of_incomplete_matches`, `current_round` (id, round_number, status), `tournament_phases[].rounds[]`. **No timer fields — timer lives on `detail/` only.** Returns 404 for completed events.

### GET /api/v2/organize/events/{event_id}/detail/
**This is where timer state lives.** Key fields: `timer_end_datetime` (static ISO UTC timestamp), `timer_is_running` (does NOT flip false on expiry), `timer_paused_at_datetime`. Also contains full `settings` and `tournament_phases`.

### GET /api/v2/organize/tournament-rounds/{round_id}/matches-list/
Default page size: **25**. Always use `page_size=200` to get all in one call. Key params: `status=in_progress`, `avoid_cache=true`, `ordering=table_number`. Key match fields: `id`, `table_number` (-1 for byes), `status`, `time_extension_seconds` (seconds; always 0 in PF+Carde mode), `is_ghost_match`, `result_reported_at` (null for draws — use `updated_at`), `player_match_relationships[].user_event_status.user_identifier` (display name string, e.g. "Aldo M"), `.user.id` (integer — stable player ID).

---

## index.html — global JS state

```javascript
_authToken       // localStorage.getItem('pf_auth_token') — our Bearer token
_isAdmin         // boolean — set from /api/me or /api/login response
allLogs          // array of unified log entries (after normalizeAll)
rawData          // last raw API response {drops, time_logs, penalties, ...}
tournamentInfo   // tournament_meta row for current tournament
rawTableData     // {drops: {table, count}, ...} — for debug display
_tournList       // array from /api/tournaments
seenHashes       // Set of hash strings — persisted to localStorage as 'pf_seen'
refreshTimer     // setInterval ID for auto-refresh
countdownTimer   // setInterval ID for countdown bar
```

---

## index.html — init chain

```
checkAuth()
  → apiFetch('/api/me')                   // verifies Bearer token
  → _isAdmin = d.is_admin
  → applyAdminVisibility()
  → loadTournaments()
      → apiFetch('/api/tournaments')
      → populate <select id="tournSelector">
      → fetchAll(true)                     // silent auto-load from cache
          → apiFetch('/api/token-status')
          → if no PF JWT: apiFetch('/api/logs?...')  // cache read
          → if PF JWT valid: syncAndLoad() → apiFetch('/api/sync?...')
          → normalizeAll(data) → renderAll()
  → checkTokenStatus()
```

If `checkAuth()` gets a 401 from `/api/me`: `showLogin()` is called. The login modal is rendered, `doLogin()` repeats the chain on success.

---

## index.html — key functions

| Function | Purpose |
|----------|---------|
| `apiFetch(url, opts, silent401)` | Wraps `fetch()`. Adds `Authorization: Bearer` header. On 401: clears token, calls `showLogin()`, throws. Pass `silent401=true` for background/interval calls to suppress the modal. |
| `checkAuth()` | Called on page load. Verifies stored token with `/api/me`, sets `_isAdmin`, starts init chain. |
| `doLogin()` | POSTs to `/api/login`, stores token in localStorage, sets `_isAdmin`, calls `applyAdminVisibility()`, starts init chain. |
| `logout()` | Calls `/api/logout`, clears `_authToken` + `_isAdmin`, calls `applyAdminVisibility()`, shows login modal. |
| `applyAdminVisibility()` | Shows/hides all `.admin-only` elements based on `_isAdmin`. Called after login, logout, and `checkAuth()`. |
| `fetchAll(silent)` | Main data-load function. Checks PF token status, tries sync or falls back to `/api/logs`. Hashes entries for new-tracking. Calls `renderAll()`. |
| `syncAndLoad(tid)` | Calls `/api/sync`, throws on non-OK response with `.status` attached for caller to check. |
| `normalizeAll(data)` | Converts raw API response into unified `allLogs` array via `normalizeDrops()`, `normalizeTimeLogs()`, `normalizePenalties()`, `normalizeTimingUpdates()`, `normalizeCoverage()`, `normalizeJudgeResults()`. |
| `renderAll()` | Applies filters, groups by round, calls `renderRoundBlock()` for each round. |
| `renderInsights()` | Builds round-by-round breakdown with timing, extensions, drops, outstanding tables. Uses `rawData.round_timers` and `rawData.round_pairings`. |
| `renderInfractions()` | Renders penalty-focused view with repeat-offender alerts. |
| `renderRoundBlock(round, extTables, penEntries, lastTable, playerMap, timerInfo, isOpen)` | Core insights renderer. Handles timer display, missing-table list, outstanding table logic. |
| `proxyFetch(url)` | Wraps `/proxy?url=` with `apiFetch`. Used by `supabase()` helper for direct Supabase queries from Debug tab. |
| `loadRawTable(table, sectionEl)` | Called by the Data tab section headers on expand. No-ops if section is closed or table already loaded. Calls `_fetchRawPage(..., 0, body)`. |
| `_fetchRawPage(table, offset, bodyEl)` | Fetches `/api/table-data?table=...&limit=200&offset=...`. On offset=0: replaces body with `_buildRawHTML()`. On subsequent pages: appends rows to existing tbody, updates/removes load-more button. |
| `_buildRawHTML(d)` | Builds the column-tag bar + scrollable table + load-more footer from an API response object. |

---

## index.html — tab structure

Tabs: `logs · insights · infractions · session · debug · guide · schema · data(admin-only)`

Pane IDs: `tab-logs · tab-insights · tab-infractions · tab-session · tab-debug · tab-guide · tab-schema · tab-data`

`switchTab(name)` matches the active tab by reading each button's `onclick` attribute value (`switchTab('${name}')`), not by index. This makes the list order irrelevant and avoids breakage when admin-only tabs are hidden. Also triggers lazy renders: `checkTokenStatus()` on session, `renderInfractions()` on infractions, `renderInsights()` on insights, and updates `#guideUserBadge` on guide.

---

## Admin-only content

Any element with class `admin-only` is shown/hidden by `applyAdminVisibility()`. Currently applied to:
- `#tab-btn-data` — the Data tab button in the nav bar
- The admin section panel inside the Guide tab
- `#cardeApiSection` — the carde.io API reference inside the Schema tab

Add `class="admin-only" style="display:none"` to any new element that should be admin-gated. No other code change needed.

---

## How to add things

**New API endpoint:**
1. Add route check in `do_GET` (or `do_POST`) after the `_require_auth()` gate.
2. Add a `_handler_method()` on the `Handler` class.
3. No auth gate needed in the method itself — it's already enforced by the gate block.

**New DB table:**
1. Add `CREATE TABLE IF NOT EXISTS` to the `executescript` in `db_init()`.
2. Add a migration block below using `PRAGMA table_info()` pattern for any new columns on an existing table.
3. Add `db_upsert_*` and `db_read_*` functions following existing patterns.
4. Call upsert in `fetch_and_store()`, include the read result in the return dict.
5. Include in both `/api/sync` and `/api/logs` response objects.

**New tab:**
1. Add `<div class="tab" onclick="switchTab('name')">Label</div>` in the tabs bar. For admin-only tabs add `class="tab admin-only"` and `style="display:none"`.
2. Add `<div id="tab-name" class="tab-pane">...</div>` with the content. No array to update — `switchTab` matches by `onclick` attribute value.
3. If the tab needs a lazy action on open, add a branch inside `switchTab()`.

**New Supabase table fetch:**
Add a `safe_supabase_get()` call in `fetch_and_store()`. It handles failures gracefully (returns `[]`). Note: table names and column names are exactly as in PurpleFox's schema — camelCase, including any typos.

**New carde.io data:**
Add processing in the `for cr in carde_rounds:` loop in `fetch_and_store()`, or add a new `_carde_get()` call. If it needs to run in the background (slow/paginated), add it to `_carde_worker()`.

---

## Gotchas and known issues

- **Stale Python processes**: `pkill -f serve.py` doesn't always work in Git Bash on Windows. When code changes aren't being picked up, find PIDs with `ps aux | grep python` and `kill -9` them explicitly.
- **`INSERT OR REPLACE` resets columns**: never use it on `tournament_meta` or any table with state fields like `is_ended`. Always use `ON CONFLICT DO UPDATE SET`.
- **`tournament_penalities` typo**: the extra `i` is in the actual PurpleFox database. The query must use this exact spelling.
- **carde top-8 rounds**: `timer_duration_minutes` is NULL for playoff bracket rounds — `timer_end_datetime` will also be NULL (it's computed from duration). This is expected.
- **Background worker lock**: `_carde_running` prevents two syncs from launching concurrent pairings fetches for the same tournament. If a sync arrives while a worker is running, the new rounds are simply skipped — they'll be picked up on the next sync.
- **`loadTournaments()` auto-calls `fetchAll(true)`**: any change to `loadTournaments()` should account for this side effect.
- **`silent401=true` on background fetches**: the token-status watcher and `fetchAll`'s token check pass `silent401=true` to avoid the login modal firing on background interval calls.
- **SQLite WAL mode**: enabled on every `db_connect()`. Don't disable it — the background worker writes concurrently with request handlers.

---

## Environment / deployment

- Dev: `python serve.py` from the project directory. Serves on `0.0.0.0:8765`.
- Prod: systemd service + nginx reverse proxy. See `docs/DEPLOY.md`.
- DB lives at `action_logs.db` in the same directory as `serve.py`. In production, the systemd `WorkingDirectory` must point to the app directory.
- No environment-variable support yet — `CARDE_API_TOKEN`, `USERS`, and `ADMINS` are hardcoded in `serve.py`. TODO item to move to env vars before public deployment.

---

## Additional context

- Use `./TOURNAMENT_MANAGEMENT.md` to understand general tournament processes, round concepts, and game-specific details
- Use `./TOOL_PURPOSE.md` to understand what the tool does, who uses it, the operational workflow, and current limitations
- Use `./CARDE_IO.md` to understand how Carde.io works, its API patterns, and known gaps/quirks
- Use `./PURPLEFOX.md` to understand how PurpleFox works, its auth model, data model details, and known gaps
- Use `./OTHER_SOFTWARES.md` for an overview of other tournament softwares and future expansion context
- Use `docs/api-exploration-lessons-learned.md` for a detailed post-mortem of what we discovered about Carde.io's API behavior, data quirks, and recommended architecture improvements — essential reading before working on any Carde.io integration

## Memory and rules

**Read these at the start of every session, before doing any work:**

- `./RULES.md` — behavioral rules, corrections, and strong preferences extracted from past sessions. If a rule here conflicts with your defaults, the rule wins.
- `./MEMORY.md` — consolidated log of past sessions (what was asked, what was learned, decisions made). Gives context on ongoing work and things already tried or ruled out.

**During the session:**
Write or update a session memory file at `memory/session_YYYY-MM-DD.md` (repo root, gitignored) with asks, learnings, decisions, and any new rules observed. See `./MEMORY.md` for the full format and instructions.

**When the user invokes the consolidation skill** ("consolidate memory", "sync memory", or "/sync-memory"):
Follow the 4-step process described in `./MEMORY.md` to append to the session log and upsert `./RULES.md`.
