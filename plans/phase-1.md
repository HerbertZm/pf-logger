# QoL Checkpoint 2 — During Phase 1

**Ship these during Phase 1.** Both need a new backend endpoint that fits naturally alongside the Phase 1 admin API work.

| Item | Description | Est. |
|---|---|---|
| QoL 6 — Operator Notes Per Round | `PATCH /api/rounds/:id/notes` + `rounds.operator_notes` column; editable inline by admin+ | 2 hrs |
| QoL 9 — Copy-to-Clipboard Round Summary | Paste-ready round summary for Discord/Slack; include operator notes if set | 1 hr |

Ship QoL 6 first — QoL 9 outputs the notes field.

**Total: ~3 hrs.**

---

# Phase 1 — Admin, Management UI, and Operations

**Goal:** Full management capability from the UI. No code changes needed between events. Operational tooling for reliable deployments.

**Prerequisites:** Phase 0 (TypeScript backend, PostgreSQL, ingestion worker running) and Design Phase (design system and shell in place).

**Note:** Items 1.1–1.3, 1.5, 1.8–1.10 from the original plan are absorbed into Phase 0. The items below are what remains.

---

## 1.1 — Admin API Endpoints

Superadmin-gated endpoints for full tournament and user management:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Uptime, DB size, session count, worker status — no auth |
| GET/POST | `/api/admin/tournaments` | List all (incl. inactive) / Create |
| PATCH/DELETE | `/api/admin/tournaments/:id` | Edit / Soft-delete |
| PATCH | `/api/admin/tournaments/:id/sources` | Toggle source enabled/disabled, update external IDs |
| GET/POST | `/api/admin/users` | List (no password_hash) / Create |
| PATCH/DELETE | `/api/admin/users/:username` | Edit role/password/active / Soft-delete + revoke sessions |
| GET | `/api/admin/sessions` | Active sessions with IP and expiry |
| DELETE | `/api/admin/sessions/:token` | Revoke session |
| GET | `/api/admin/backup` | Stream PostgreSQL dump |
| GET/PATCH | `/api/admin/config` | Read/set app-level config (default refresh interval, etc.) |

**Guards:**
- Superadmin cannot deactivate their own account
- Deactivating a user immediately deletes all their active sessions
- `end-tournament` and `backfill` restricted to admin+

**Validation:**
- Username: `^[a-z0-9_-]{3,32}$`
- Password: 6–128 chars
- Role: enum (`user` | `admin` | `superadmin`)
- Tournament name/short: non-empty, max 128 chars, stripped
- External IDs: positive integer (Carde) or UUID format (PF) if provided

**Audit logging** to `app_activity`: `tournament_created`, `tournament_updated`, `tournament_deactivated`, `source_toggled`, `user_created`, `user_updated`, `user_deactivated`, `session_revoked`, `login_failed`, `backup_downloaded`.

---

## 1.2 — Manage Tab (Superadmin-only)

New tab in the UI with three panels, lazy-loaded:

**Tournaments panel**
- List of all tournaments (active + inactive), with source badges showing which providers are enabled
- Edit: name, short name, external IDs, source enabled/disabled toggles
- Deactivate / Reactivate
- Add new tournament form
- Ended tournaments sorted to bottom of the tournament selector

**Users panel**
- Table with color-coded role badge, last login, active status
- Inline role edit, Reset Password, Deactivate/Reactivate
- Create user form
- Own row: role and deactivate buttons disabled

**Sessions panel**
- Active sessions with username, IP, user agent, expiry
- Revoke button per row

**Other:**
- "End event" button gated to superadmin only
- Session tab: improve PF JWT extraction instructions (step-by-step DevTools guide with screenshots)

---

## 1.3 — Operational Tooling

- Structured logging via a logger module (replaces scattered `console.log`) — log level from env var
- `/api/health` expanded: last successful sync time per tournament, worker running status, PF JWT expiry, DB connection status
- Pre-event checklist visible in Manage tab: health endpoint all-green + PF JWT valid + at least one tournament configured + test sync succeeds
- `DEPLOY.md` updated with full env var list, PostgreSQL setup, and systemd service configuration

---

## Verification Checklist

- Superadmin creates tournament from UI → appears in selector immediately
- Toggle PF source to disabled → judge-facing UI hides drops/coverage columns without page reload
- New user created, can log in with that password
- Admin role cannot reach `/api/admin/users` (403)
- Rate limit fires at 11th login attempt from same IP (429)
- Deactivating a user immediately invalidates their open sessions
- All existing sync/log/backfill flows work unchanged
- Health endpoint returns correct worker status and last sync times
