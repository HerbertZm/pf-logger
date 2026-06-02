# P0 Code Review — Lessons for Phase 1

These patterns were identified during the P0 review and must be followed from day one in Phase 1.
They're already fixed in P0 code; don't regress them.

**Backend:**
- All Prisma access goes through `src/db/prisma.ts` singleton — never `new PrismaClient()` in a route or middleware file.
- All async route handlers must be wrapped with `asyncHandler` from `src/middleware/asyncHandler.ts`. (Express 5 propagates async errors natively, but the wrapper is kept for explicitness — do not remove it.)
- Role values on user create/update must be validated against the `VALID_ROLES` enum — any string is not acceptable.
- `GET /api/logout` must be `POST` — GET can be triggered by browser prefetch.
- Admin session list must never return live bearer tokens (`select` must exclude `token` field).
- PF JWT lives in `src/ingestion/jwtStore.ts` only — never write a JWT to the DB, only write `expiresAt`.
- When `tournamentId` is required, use `if (!tid) { res.status(400)... }` explicitly — don't rely on `tid ? ... : {}` semantics that silently fetch all rows when `tid = 0`.
- Always `select` to exclude sensitive fields from list responses (tokens, password hashes).

**Frontend:**
- Auth events: `auth:login` is dispatched after successful login; `auth:logout` after logout. Any context that fetches auth-gated data should listen for these to re-fetch / clear.
- The `api.post` method exists — use it for mutations. Never use `api.get` for state-changing operations.
- Cleanup `setInterval`/`setTimeout` refs in `useEffect` return functions.

**Domain rule reminder (see CLAUDE.md for full list):**
- `completedAt` on a round must never be used to compute timing. It equals the next round's `started_at`. `overtimeMinutes` is `null` until the worker captures a snapshot at timer expiry.

---

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

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/api/health` | Uptime, DB liveness — no auth | ✅ done (P0) |
| GET | `/api/admin/events` | List events (timezone, linked tournament count) | ⬜ todo (§1.2) |
| POST | `/api/admin/events` | Create event with timezone | ⬜ todo (§1.2) |
| PATCH | `/api/admin/events/:id` | Edit event; optional timezone cascade | ⬜ todo (§1.2) |
| GET | `/api/admin/tournaments` | List all incl. soft-deleted | ✅ done (P0) |
| POST | `/api/admin/tournaments` | Create tournament + source mappings; inherit tz from event | ⬜ todo |
| PATCH | `/api/admin/tournaments/:id` | Edit name, game, event, timezone, external IDs | ⬜ todo |
| DELETE | `/api/admin/tournaments/:id` | Soft-delete | ✅ done (P0) |
| PATCH | `/api/admin/tournaments/:id/sources` | Toggle source enabled/disabled, update external IDs | ⬜ todo |
| GET | `/api/admin/users` | List (no password_hash) | ✅ done (P0) |
| POST | `/api/admin/users` | Create user | ✅ done (P0) |
| PATCH | `/api/admin/users/:id` | Edit role / isActive | ✅ done (P0) |
| GET | `/api/admin/sessions` | Active sessions (IP, expiry — no token) | ✅ done (P0) |
| DELETE | `/api/admin/sessions/:id` | Revoke session | ✅ done (P0) |
| GET | `/api/admin/backup` | Stream PostgreSQL dump | ⬜ Phase 3 |
| GET/PATCH | `/api/admin/config` | App-level config (refresh interval, etc.) | ⬜ todo |

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
- Timezone: valid IANA identifier (e.g. `America/New_York`) — required on create; validated server-side
- Venue: optional display string, max 256 chars — not used for time math

**Audit logging** to `app_activity`: `tournament_created`, `tournament_updated`, `tournament_deactivated`, `source_toggled`, `user_created`, `user_updated`, `user_deactivated`, `session_revoked`, `login_failed`, `backup_downloaded`.

---

## 1.2 — Event + tournament timezone (display)

**Goal:** All user-facing timestamps render in the tournament's local timezone. Storage stays UTC (`TIMESTAMPTZ`) everywhere — conversion happens only at display time.

Set timezone **once per event** (e.g. a Regional Weekend); tournaments under that event inherit it automatically. Tournaments can still override individually when needed.

Resolves **OD-4** (was blocking StageTimer work in Phase 2; ship the config in P1 so logs, dashboard, and round schedule are correct before StageTimer import lands).

Introduces a **minimal `app_events` shell in P1** (timezone + naming only). Phase 2.1 adds permissions, staff scoping, and the Events-first Manage layout on top of this — see `plans/phase-2.md` §2.1.

### Schema

**`app_events`** (new — P1 subset of full event model)

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | `TEXT NOT NULL` | e.g. "Atlanta Regional Weekend" |
| `short_name` | `TEXT NOT NULL` | Selector label |
| `timezone` | `TEXT NOT NULL` | IANA identifier — **canonical tz for the weekend** |
| `venue` | `TEXT NULL` | Optional display label for the whole event |
| `starts_at` / `ends_at` | `TIMESTAMPTZ NULL` | Optional; full scheduling in P2 if needed |
| `is_active` | `BOOLEAN` | Default true |

**`app_tournaments`** (additions)

| Column | Type | Notes |
|---|---|---|
| `event_id` | `INT NULL` FK → `app_events` | Nullable — standalone tournaments remain valid (OD-1) |
| `timezone` | `TEXT NOT NULL` | IANA identifier used for display — **denormalized copy** from event at link/create time |
| `venue` | `TEXT NULL` | Optional; may copy from event or be tournament-specific |

Do **not** use event location as the primary timezone input — geocoding is ambiguous and still resolves to an IANA id under the hood. Store the timezone on the event; tournaments get a copied value.

**Inheritance rules (server-side):**

| Action | Behavior |
|---|---|
| Create tournament with `eventId` | Copy `event.timezone` (+ `venue` if tournament venue omitted) onto the new tournament row |
| Link existing tournament to event (`PATCH` set `eventId`) | Autopopulate tournament `timezone` from event **only if** tournament still has the migration default / was never explicitly set; otherwise leave as-is unless user checks "Apply event timezone" |
| Create tournament without `eventId` | Require `timezone` on the request body (same as today) |
| `PATCH` event `timezone` | Optional `applyTimezoneToTournaments: true` — bulk-update all linked tournaments' `timezone` to match (audit log: `event_timezone_cascaded`) |

Display code always reads **`tournament.timezone`** (no join required per request). Event timezone is the setup convenience, not the runtime lookup path.

Migrations: backfill orphan tournaments to a sensible default tz (e.g. `America/New_York`) or require superadmin to set on first edit. No forced 1:1 event wrapper for existing data (OD-1).

### API

**Events (superadmin):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/events` | List events with timezone |
| POST | `/api/admin/events` | Create event (`name`, `shortName`, `timezone`, optional `venue`) |
| PATCH | `/api/admin/events/:id` | Edit event; optional `applyTimezoneToTournaments` on timezone change |
| DELETE | `/api/admin/events/:id` | Soft-delete or deactivate (only if no active tournaments, or detach first) |

**Tournaments (extend existing admin routes):**

- `Tournament` response includes `timezone`, optional `venue`, optional `eventId` + nested `event: { id, name, shortName, timezone }`
- `POST /api/admin/tournaments` — `eventId` optional; if set, inherit tz from event (body `timezone` ignored unless `timezoneOverride` flag); if unset, require `timezone`
- `PATCH /api/admin/tournaments/:id` — allow `eventId`, `timezone`, `venue`; re-linking to event can offer inherit-from-event
- Validate all `timezone` values with `Intl.DateTimeFormat` / known IANA list; reject invalid strings with 400

### Frontend

- **`TournamentContext`:** expose `activeTournament.timezone` (and `venue` if needed for UI)
- **`formatInTournamentTz(isoUtc, timezone, options?)`** — shared helper using `Intl.DateTimeFormat` with `timeZone`
- Wire into: round schedule pane (indicators), log feed entry times, dashboard timer labels, insights tables — anywhere a wall-clock time is shown to staff
- Context bar: show active tournament name + short tz hint (e.g. `EDT` or `UTC-4`) so judges know what clock they're reading

### Manage tab

**Events panel (new, above tournaments):**

- List events with name, timezone, tournament count
- Create/edit event: name, short name, timezone picker, optional venue
- Changing event timezone → confirm dialog if cascading to linked tournaments

**Tournaments panel (updated):**

- "Event" dropdown on create — selecting an event **autofills** timezone (+ venue) as read-only unless "Override timezone" is checked
- Standalone tournament: timezone picker required (no event)
- Edit: show linked event; button to re-apply event timezone

### Ingestion (unchanged principle)

- Carde/PF timestamps continue to normalize to UTC at ingestion (see `SCHEMA_DESIGN.md`)
- Tournament timezone is **never** written onto raw/normalized rows — display-layer only

**Est.:** ~6 hrs (events table + CRUD + tournament inherit logic + migration + display helper + Manage UI).

---

## 1.3 — Background Ingestion Worker (moved from P0.4)

Module at `src/ingestion/worker.ts`, same deployment as HTTP server. Runs independently on startup.

- Polls Carde on a configurable interval per active tournament using `status=in_progress` — never fetches full match lists
- At `timer_end_datetime`, immediately fetches in-progress matches and stores result as `rounds.missing_tables_json` with `snapshot_captured_at` timestamp
- For PF: polls on the same interval (Supabase real-time not used — too complex relative to the polling interval we need). PF fetches are skipped if `jwtStore` has no valid token.
- PF JWT lifecycle: ~48h validity, no refresh token. When JWT expires mid-event, worker logs the failure, sets `last_error` in `worker_state`, and continues Carde-only until a new JWT is pasted. The `/api/health` endpoint surfaces JWT expiry status so staff can see it without checking logs.
- Writes to raw tables only; triggers normalized layer update after each raw write
- Stores per-tournament state in `worker_state` table — survives restarts
- `is_ghost_match` flag from Carde is informational only — ghost marking may happen outside Carde

---

## 1.4 — Manage Tab (Superadmin-only)

> **Detailed implementation plan:** `plans/ui-implementation.md` Step 12 — covers `ManageTab.tsx`, `TournamentPanel`, `UsersPanel`, `SessionsPanel`, form components, badge vs. CTA visual rules, and the superadmin guard. Requires P1.1 admin API endpoints to be complete first.

New tab in the UI with three panels, lazy-loaded:

**Tournaments panel**
- List of all tournaments (active + inactive), with source badges showing which providers are enabled
- Edit: name, short name, game, timezone, optional venue, external IDs, source enabled/disabled toggles
- Deactivate / Reactivate
- Add new tournament form (game + timezone required)
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
- Session panel (gear icon in TopBar): PF JWT paste and status. Calls `POST /api/session/pf-jwt` to submit, `GET /api/session/pf-jwt` to poll status. Shows: current status (valid/expired/missing), expiry time, who set it, and a warning when `inMemory: false` (restart happened — re-paste required even if not yet expired). Step-by-step DevTools extraction guide inline.

---

## 1.5 — Operational Tooling

- Structured logging via a logger module (replaces scattered `console.log`) — log level from env var
- `/api/health` expanded: last successful sync time per tournament, worker running status, PF JWT expiry, DB connection status
- Pre-event checklist visible in Manage tab: health endpoint all-green + PF JWT valid + at least one tournament configured + test sync succeeds
- `DEPLOY.md` updated with full env var list, PostgreSQL setup, and systemd service configuration

---

## 1.6 — CI/CD Pipeline (GitHub Actions)

Automate type-checking, linting, building, and deploying to the VPS on every push to `main`. No manual SSH required after initial setup.

### What the pipeline does

On push to `main`:

1. **Type-check** — `tsc --noEmit` on both `src/` and `client/src/`
2. **Lint** — ESLint on both
3. **Build** — `npm run build` (compiles TypeScript API + Vite React frontend to `dist/`)
4. **Deploy** — SSH to VPS, pull latest code, install deps, run Prisma migrations, rebuild, restart service

The deploy step only runs if the build step passes. A broken build never reaches the server.

### GitHub Actions workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run build

      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/pf-logger
            git pull origin main
            npm ci --omit=dev
            npx prisma migrate deploy
            npm run build
            sudo systemctl restart pf-logger
```

### Required GitHub secrets

Add these in the repo under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `VPS_HOST` | VPS IP or hostname |
| `VPS_USER` | SSH user (e.g. `deploy`) |
| `VPS_SSH_KEY` | Private half of the deployment SSH key pair |

### VPS setup for CI/CD

See `docs/DEPLOY.md` — the "CI/CD access" section covers generating the key pair, adding the public key to the VPS, and validating the connection before wiring up GitHub.

### `package.json` scripts required

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit && tsc --noEmit -p client/tsconfig.json",
    "lint": "eslint src client/src",
    "build": "tsc -p tsconfig.build.json && vite build --root client",
    "start": "node dist/server.js",
    "dev": "concurrently \"ts-node-dev src/server.ts\" \"vite --root client\""
  }
}
```

---

## Verification Checklist

- Superadmin creates event with timezone → creating a tournament under that event autofills timezone (no manual re-entry)
- Superadmin creates standalone tournament with game + timezone → appears in selector immediately
- Log feed and round schedule times match venue wall clock (not browser local / not raw UTC)
- Invalid timezone rejected on create (400)
- Event timezone cascade updates all linked tournaments when confirmed
- Toggle PF source to disabled → judge-facing UI hides drops/coverage columns without page reload
- New user created, can log in with that password
- Admin role cannot reach `/api/admin/users` (403)
- Rate limit fires at 11th login attempt from same IP (429)
- Deactivating a user immediately invalidates their open sessions
- All existing sync/log/backfill flows work unchanged
- Health endpoint returns correct worker status and last sync times
