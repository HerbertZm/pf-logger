# pf-logger Productionization Plan

## Context

The app is currently a functional, single-file tournament ops dashboard (serve.py + index.html, zero external Python deps, SQLite). It works well but has several hardcoded config points that make it painful to operate across multiple events without touching code:

- Tournaments (PurpleFox UUID + carde.io IDs) are hardcoded in a `TOURNAMENTS` dict
- Users and their roles are hardcoded in `USERS`, `ADMINS`, `SUPERADMINS` constants
- Passwords are stored in plaintext in serve.py
- Sessions are in-memory (`_sessions` dict) and lost on every server restart

The goal is to make all of this manageable from the UI without code changes, while adding a handful of additional production hardening improvements.

---

## 1. Database Schema Changes

### `app_tournaments` (replaces `TOURNAMENTS` dict)

```sql
CREATE TABLE IF NOT EXISTS app_tournaments (
    id                   TEXT PRIMARY KEY,          -- PurpleFox UUID (same as tournament_id everywhere)
    name                 TEXT NOT NULL,
    short                TEXT NOT NULL,
    carde_event_id       INTEGER,                   -- nullable: event might not be on carde yet
    carde_base_round_id  INTEGER,                   -- first_round_id - 1, nullable
    created_at           TEXT NOT NULL,
    created_by           TEXT NOT NULL,
    is_active            INTEGER NOT NULL DEFAULT 1 -- 0 = soft-deleted/hidden from selector
);
```

Note: `is_ended` stays in `tournament_meta` (different semantics — event completed vs. hidden from UI).

### `app_users` (replaces `USERS`/`ADMINS`/`SUPERADMINS` dicts)

```sql
CREATE TABLE IF NOT EXISTS app_users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,                -- SHA-256(password + pepper) hex
    role          TEXT NOT NULL DEFAULT 'user', -- 'user' | 'admin' | 'superadmin'
    created_at    TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    is_active     INTEGER NOT NULL DEFAULT 1    -- 0 = cannot log in; sessions revoked immediately
);
```

Note: separate from existing `users` table (PurpleFox UUID→name cache). Admin browser must project `app_users` without the `password_hash` column.

### `sessions` (replaces `_sessions` dict — persistent across restarts)

```sql
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL,
    exp        REAL NOT NULL,   -- Unix timestamp float
    created_at TEXT NOT NULL,
    ip         TEXT,
    user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_exp ON sessions(exp);
```

### Seed migration (run once at `db_init()`, idempotent via `INSERT OR IGNORE`)

```python
def _seed_initial_data(conn):
    # Seed hardcoded tournaments
    _hardcoded = {
        "4ac50cb1-...": {"name": "Atlanta Regional Qualifier", "short": "Regional Qualifier",
                         "carde_event_id": 502327, "carde_base_round_id": 721201},
        "17ed5ad8-...": {"name": "Regional Rebound", "short": "Regional Rebound",
                         "carde_event_id": 513852, "carde_base_round_id": 727668},
    }
    for tid, cfg in _hardcoded.items():
        conn.execute("INSERT OR IGNORE INTO app_tournaments (...) VALUES (..., 'system')", (...))

    # Seed hardcoded users with hashed passwords
    for username, password, role in [("admin","admin","admin"),("hj","hj","user"),("hz","hz","superadmin")]:
        conn.execute("INSERT OR IGNORE INTO app_users (...) VALUES (..., 'system')", (...))
```

---

## 2. Backend Changes (`serve.py`)

### Password hashing helper

```python
import hashlib, os

_PASSWORD_PEPPER = os.environ.get("PF_PASSWORD_PEPPER", "pf-logger-default")

def _hash_password(password: str) -> str:
    return hashlib.sha256((password + _PASSWORD_PEPPER).encode()).hexdigest()
```

Add `PF_PASSWORD_PEPPER` to the systemd `Environment=` line (per DEPLOY.md).

### Auth refactor callsite map

| Old reference | New replacement |
|---|---|
| `USERS.get(username) != password` | DB lookup + `_hash_password()` compare |
| `_sessions[token] = {...}` | `INSERT INTO sessions ...` |
| `_sessions.get(token)` | `SELECT FROM sessions WHERE token=? AND exp>?` |
| `_sessions.pop(token)` | `DELETE FROM sessions WHERE token=?` |
| `username in ADMINS` | `_get_user_role(username) in ("admin","superadmin")` |
| `username in SUPERADMINS` | `_get_user_role(username) == "superadmin"` |
| `TOURNAMENTS.get(tid, {})` | `_get_tournament_config(tid)` |
| `TOURNAMENTS.items()` | `SELECT * FROM app_tournaments WHERE is_active=1` |
| `tid not in TOURNAMENTS` | `_get_tournament_config(tid) == {}` |

### New helpers

```python
def _get_tournament_config(tournament_id) -> dict:
    # SELECT * FROM app_tournaments WHERE id = ?  →  dict or {}

def _get_user_role(username) -> str:
    # SELECT role FROM app_users WHERE username = ?  →  str or ""

def _require_admin(self) -> str | None:
    # calls _require_auth(), then checks role in ("admin","superadmin")

def _require_superadmin(self) -> str | None:
    # calls _require_auth(), then checks role == "superadmin"

def _cleanup_sessions():
    # DELETE FROM sessions WHERE exp < now()
    # called at startup + every hour via threading.Timer
```

### Login rate limiting (no new deps)

```python
_login_attempts = {}  # ip → [timestamp, ...]

def _check_rate_limit(ip, window=60, max_attempts=10) -> bool:
    # prune old, append now, return True if over limit → respond 429
```

### New API endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | None | Uptime, DB size, session count, tournament count |
| GET | `/api/admin/tournaments` | Superadmin | List all (including inactive) |
| POST | `/api/admin/tournaments` | Superadmin | Create tournament |
| PATCH | `/api/admin/tournaments/<id>` | Superadmin | Edit name/short/carde IDs |
| DELETE | `/api/admin/tournaments/<id>` | Superadmin | Soft-delete (is_active=0) |
| GET | `/api/admin/users` | Superadmin | List all users (no password_hash) |
| POST | `/api/admin/users` | Superadmin | Create user |
| PATCH | `/api/admin/users/<username>` | Superadmin | Edit role/password/is_active |
| DELETE | `/api/admin/users/<username>` | Superadmin | Soft-delete + revoke sessions |
| GET | `/api/admin/sessions` | Superadmin | List active sessions |
| DELETE | `/api/admin/sessions/<token>` | Superadmin | Revoke specific session |
| GET | `/api/admin/backup` | Superadmin | Stream SQLite file (after WAL checkpoint) |

### Validation rules for new endpoints

- `username`: regex `^[a-z0-9_-]{3,32}$`
- `role`: must be `"user"`, `"admin"`, or `"superadmin"`
- `id` (tournament): UUID4 regex
- `name`/`short`: non-empty, max 128 chars (stripped)
- `carde_event_id` / `carde_base_round_id`: positive int if provided
- `password`: 6–128 chars

Return `{"error": "field: reason"}` for validation failures.

### Guards

- Superadmin cannot deactivate or demote their own account (check `target == acting`)
- Deactivating a user must `DELETE FROM sessions WHERE username = ?` immediately
- `end-tournament` and `backfill` restricted to admin+ (currently any authed user)
- `app_users` in table browser must project `username, role, is_active, created_at, created_by` only

### Audit logging (use existing `db_log_activity()`)

Log these new event types: `tournament_created`, `tournament_updated`, `tournament_deactivated`, `user_created`, `user_updated`, `user_deactivated`, `session_revoked`, `db_backup_downloaded`, `login_failed`.

---

## 3. Frontend Changes (`index.html`)

### New "Manage" tab (superadmin-only)

```html
<!-- Add to tabs bar -->
<div class="tab superadmin-only" id="tab-btn-manage" onclick="switchTab('manage')">Manage</div>

<!-- New tab pane — add before <script> block -->
<div id="tab-manage" class="tab-pane">
  <!-- Panel 1: Tournaments -->
  <!-- Panel 2: Users -->
  <!-- Panel 3: Active Sessions -->
</div>
```

Lazy-load in `switchTab('manage')` if `_isSuperadmin`: call `loadTournamentAdmin()`, `loadUserAdmin()`, `loadSessionAdmin()`.

### Tournament management panel

**List** (`loadTournamentAdmin()` → `GET /api/admin/tournaments`): columns — Name, Short, PF UUID (truncated), carde event ID, Status (active/ended/inactive), buttons: Edit / Deactivate.

**Add form** (always visible below list):
```
[Name] [Short name]
[PurpleFox UUID]          ← tooltip: "id field from purple-fox.fr tournament URL"
[carde.io event ID (opt)] [carde.io base round ID (opt)]
[Add tournament]
```

**Edit flow**: inline per-row form (hidden by default), pre-populated, Save → PATCH.

### User management panel

**Table** (`loadUserAdmin()` → `GET /api/admin/users`): Username, Role (color-coded badge), Status, Created at, Created by. Per-row: inline role dropdown + Save, Reset Password (shows inline input), Deactivate/Reactivate. Own row: buttons disabled with tooltip.

**Role badge CSS:**
```css
.role-user{color:var(--muted)}
.role-admin{color:var(--judge)}
.role-superadmin{color:var(--accent-bright)}
```

**Create form:**
```
[Username] [Password] [Role: select]  [Create user]
```

### Active sessions panel

Table: Username, IP, Created at, Expires at. Revoke button → `DELETE /api/admin/sessions/<token>`.

### Other UX improvements

- **Session tab**: Add step-by-step DevTools instructions for JWT extraction (Local Storage → `sb-*-auth-token` key → copy `access_token` value)
- **End event button**: Restrict to `_isSuperadmin` (move from any-admin to superadmin only)
- **Tournament selector**: Sort ended tournaments to the bottom of the dropdown

---

## 4. Implementation Order

Designed so each phase leaves the server in a working state.

### Phase 1 — DB schema + seeding (no behavior change)
1. Add 3 new tables to `db_init()` executescript
2. Add `_hash_password()` and `_seed_initial_data()`
3. Verify: restart, check tables populated, everything else works

### Phase 2 — Auth migration
4. Update `_login()` to check `app_users` + hash compare
5. Update session creation/lookup/logout to use `sessions` table
6. Update `_require_admin()` / `_require_superadmin()` to use `_get_user_role()`
7. Remove `_sessions`, `USERS`, `ADMINS`, `SUPERADMINS`
8. Add `_cleanup_sessions()` on startup + hourly timer
9. Verify: login, logout, session survives restart

### Phase 3 — Tournament migration
10. Add `_get_tournament_config()`
11. Update `/api/tournaments`, `/api/sync`, `/api/end-tournament`, `/api/backfill`
12. Remove `TOURNAMENTS` dict
13. Verify: selector loads, sync works, backfill works

### Phase 4 — New admin endpoints
14. Add all `/api/admin/*` endpoints with validation + audit logging
15. Add `/api/health`
16. Add login rate limiting
17. Restrict `end-tournament` and `backfill` to admin+
18. Verify with curl / Debug tab

### Phase 5 — Frontend
19. Add Manage tab + tournament panel + user panel + sessions panel
20. Improve Session tab JWT instructions
21. Gate End event to superadmin
22. Sort ended tournaments to bottom of selector
23. Test end-to-end: create tournament, create user, login as new user, verify visibility

### Phase 6 — Polish
24. Add `GET /api/admin/backup` with WAL checkpoint
25. Add startup backfill background thread
26. Update AGENT_CONTEXT.md and DEPLOY.md

---

## 5. Key Edge Cases and Gotchas

- **`app_users` in table browser**: must project without `password_hash` — add it to the `ALLOWED` set but with a custom SELECT
- **Deactivating a user**: must immediately `DELETE FROM sessions WHERE username=?`
- **`INSERT OR IGNORE` for seeding**: existing data (user-changed passwords, newly added tournaments) wins over hardcoded defaults on re-run
- **`/api/admin/backup`**: run `PRAGMA wal_checkpoint(FULL)` before streaming the file
- **PATCH with empty body**: reject 400; build UPDATE SET dynamically from validated keys
- **`_get_user()` performance**: two DB primary-key lookups per request (sessions + app_users). Fine for <10 concurrent users; add LRU cache if it ever becomes a bottleneck
- **`/api/tournaments` API shape**: keep returning `is_admin`/`is_superadmin` booleans in `/api/me` and `/api/login` — derive from the `role` column; frontend does not need to know about the string value

---

## 6. Verification

1. Restart server — existing users (admin/hj/hz) can still log in with same passwords
2. Existing tournaments appear in selector and sync correctly
3. Sessions survive a server restart
4. Superadmin can add a new tournament via the Manage tab → appears in selector immediately
5. Superadmin can create a new user → user can log in with the given password
6. Admin cannot access `/api/admin/users` (403)
7. Regular user cannot access `/api/admin/*` or the Data tab
8. Deactivating a user revokes active sessions immediately
9. `/api/health` returns 200 with no auth
10. `/api/admin/backup` streams the SQLite file
11. Login rate limiting: 11 attempts from same IP → 429

---

## Critical Files

- `/home/hz/code/pf-logger/serve.py` — all backend changes
- `/home/hz/code/pf-logger/index.html` — all frontend changes
- `/home/hz/code/pf-logger/DEPLOY.md` — add `PF_PASSWORD_PEPPER` env var
- `/home/hz/code/pf-logger/AGENT_CONTEXT.md` — update endpoint reference and table list
