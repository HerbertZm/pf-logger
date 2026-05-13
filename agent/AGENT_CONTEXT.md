# Agent Context — PurpleFox Action Log Exporter

Everything an agent needs to work on this codebase without re-deriving it from scratch.

---

## What this is

A local-network web tool for tournament administrators running Magic/Riftbound events on PurpleFox. It pulls data from two external sources (Supabase/PurpleFox + carde.io), stores it in a local SQLite database, and presents it as a real-time dashboard with drops, time extensions, penalties, round timing, and judge activity.

**No build step. No external Python dependencies. Runs with `python serve.py`.**

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
```

Two completely separate auth layers:
- **Local auth** (`Bearer <token>`): our own users (admin/hj). Required for all API routes except `/api/login`. Sessions live in `_sessions` dict, expire after 7 days.
- **PurpleFox JWT**: a Supabase JWT from a logged-in PF user. Required only for `/api/sync` and `/proxy`. Stored in `_state["token"]` in-memory.

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

## serve.py — all API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/login` | none | Returns `{ok, token, username, is_admin}`. Sets session in `_sessions`. |
| GET | `/api/logout` | Bearer | Removes token from `_sessions`. |
| GET | `/api/me` | Bearer | Returns `{username, is_admin}`. |
| GET | `/api/tournaments` | Bearer | Returns list from `TOURNAMENTS` + `is_ended` from DB. |
| GET | `/api/logs?tournamentId=` | Bearer | Reads all tables from SQLite, returns full dataset. No network calls. |
| GET | `/api/sync?tournamentId=` | Bearer + PF JWT | Calls `fetch_and_store()`, returns full dataset. Requires valid `_state["token"]`. |
| GET | `/api/backfill[?tournamentId=]` | Bearer | Re-fetches carde.io round data for all (or one) tournament(s). |
| GET | `/api/table-data?table=&limit=&offset=` | Bearer + admin | Read rows from a whitelisted SQLite table. Returns `{table, columns, rows, total, limit, offset}`. Max 200/page, cap 500. Returns 403 for non-admins. Allowed tables: drops, time_logs, penalties, table_time_updates, table_coverage, table_judge_results, tournament_meta, table_players, round_pairings, rounds_fetched, round_timers, users. |
| GET | `/api/end-tournament?tournamentId=` | Bearer | Sets `is_ended=1` in `tournament_meta`. |
| POST | `/api/set-token` | Bearer | Stores PF JWT in `_state`. Decodes + validates expiry. Seeds user cache from JWT metadata. |
| GET | `/api/token-status` | Bearer | Returns status/expiry of stored PF JWT. |
| GET | `/api/schema` | Bearer | Proxies to Supabase PostgREST OpenAPI endpoint. |
| GET | `/proxy?url=` | Bearer + PF JWT | Authenticated proxy restricted to `upbcarvmkmyzhbosheyo.supabase.co`. |

All Bearer-required routes: `_require_auth()` is called at the top of `do_GET`/`do_POST` before the route dispatch. It reads `Authorization: Bearer <token>`, looks up `_sessions`, checks expiry, sends 401 JSON and returns `None` on failure.

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
Primary source: `tournament_drops` Supabase table.
PK: `(tournament_id, player_game_id, round)`.
Key cols: `is_checked`, `is_cancelled`, `added_by_name` (stamped on first unchecked insert), `verified_by_name` (stamped when `is_checked` transitions to 1). Three-pass upsert: INSERT OR IGNORE → UPDATE unchecked → UPDATE checked.

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
- `started_at` — when TO started the clock
- `timer_end_datetime` — derived: `started_at + timer_duration_minutes * 60 + extra_time_seconds`
- `completed_at` — when round marked COMPLETE (after all results in)
- `timer_duration_minutes` — base duration; NULL for top-8 bracket rounds
- `extra_time_seconds` — round-level extra time; also seen as `additional_time_seconds` in carde response
- `carde_status` — UPCOMING / SCHEDULED / ACTIVE / COMPLETE
- `incomplete_at_end` — number of tables without results at moment timer hit zero
- `missing_tables_json` — JSON array of table numbers that were outstanding at time-called

### users
Name cache: `(user_id TEXT PK, display_name TEXT)`. Seeded from drops, penalties, global drops, and JWT metadata. Used to resolve UUID → display name via `db_resolve_name()`.

---

## Supabase notes

- Column names are camelCase in PurpleFox schema (`tournamentId`, `tableNumber`, etc.).
- Filter key is `tournamentId` not `tournament_id`.
- `tournament_penalities` has a typo — the extra 'i' is in the actual PF schema.
- `tournament_logs` only contains time-extension entries, not a general log.
- OpenAPI endpoint (`/rest/v1/`) returns 401 even with a valid JWT — cannot use for schema discovery.

---

## carde.io API

Base: `https://api.admin.carde.io`. Auth: `Authorization: Token {CARDE_API_TOKEN}`.

### GET /api/magic-events/{event_id}/get_all_rounds/
Returns array of phase objects. Each phase has `rounds: []`. Key round fields: `id`, `round_number`, `status`, `started_at`, `completed_at`, `timer_duration_minutes`, `extra_time_seconds` / `additional_time_seconds`, `timer_end_datetime`.

### GET /api/magic-events/{event_id}/tournament_overview/
Live snapshot. Key fields: `lifecycle_status`, `timer_is_running`, `timer_end_datetime`, `timer_paused_at_datetime`, `number_of_incomplete_matches`, `current_round.round_number`, `current_round.status`.

### GET /api/v2/organize/tournament-rounds/{round_id}/matches-list/
Query params: `round_id={id}&page_size=25[&page={n}]`. Paginated — loop while `response.next` is truthy, using it as the next `page=` value. Key match fields: `id`, `table_number`, `match_is_bye`, `status`, `time_extension_seconds`, `winning_player_id`, `player_match_relationships[].player_order`, `.user_event_status.user_identifier`, `.user_event_status.user.id`.

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
