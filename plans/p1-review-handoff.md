# pf-logger — Phase 1 completion review (detailed handoff)

> **Status: WRAPPED (2026-06-02).** Branch `hz/random-v2`: `f46b5b6` (Phase 1) + `5ed2538` (UTC). Use `plans/phase-2.md` for active work. **Copy-paste review prompt:** § [Agent review prompt](#agent-review-prompt-copy-paste) below.

## Mission

Review Phase 1 implementation. **`plans/phase-1.md` and `plans/qol.md` synced with code.** Safe to merge per `CLAUDE.md` / `agent/RULES.md`.

**Health endpoints:** public `GET /api/health` (liveness); full `GET /api/admin/health` (Manage checklist). **Migrations:** use `npx prisma migrate deploy` or `npm run db:apply-pending` if P1002 (dev server running).

---

## Read-first docs

| Doc | Why |
|-----|-----|
| `CLAUDE.md` | Domain invariants (`completed_at`, extensions, Top-8 timers, JWT, Prisma import path) |
| `agent/RULES.md` | ESLint/style, 44px touch targets, no animating poll data |
| `plans/phase-1.md` | P1 scope + shipped table (marked COMPLETE) |
| `plans/qol.md` | QoL 1–13 status |
| `docs/DEPLOY.md` | Deploy, migrate, CI, secrets |
| `docs/SCHEMA_DESIGN.md` | Three-layer data model |

---

## Verification already run (re-run on your machine)

```bash
npm run db:generate   # OK
npm run typecheck     # OK
npm run lint          # OK — 11 warnings only in src/db/seed-test-tournament.ts (no-console)
npm run build         # OK
npx prisma migrate deploy  # FAILED locally: P1002 advisory lock — stop npm run dev first
```

**New migrations in this diff (apply in order):**

1. `src/db/migrations/20260602120000_add_operator_notes/` — `rounds.operator_notes`
2. `src/db/migrations/20260602140000_events_and_timezone/` — `app_events`, tournament `event_id` / `timezone` / `venue`
3. `src/db/migrations/20260602160000_app_config/` — singleton config row

Earlier on branch (confirm applied): `20260601120000_add_games`, `20260601_add_test_tournament_flag`.

**Env:** optional `LOG_LEVEL` added to `.env.example`. No other new required vars.

---

## What P0 already had vs what this branch adds

**P0 (prior commits):** TypeScript + Express 5, Prisma 7 → PostgreSQL, ingestion worker (raw + normalized), auth, basic admin routes, React shell, Reports tab + sidebar (`f3ed4e0`), `DashboardRoundProvider` for schedule → live round selection.

**This uncommitted delta (P1 + QoL):** Full superadmin **Manage** UI, events/timezone model, operator notes, app config (poll intervals + logistics threshold), expanded health endpoint, audit log, manual sync/backfill + **backfill-from-raw** module, CI/CD workflow, large Logs/Insights/Dashboard UX pass, test tournament scenarios, Guide tab + keyboard shortcuts.

---

## Database / Prisma

### New tables

- **`app_events`** — `name`, `short_name`, `timezone`, optional `venue`, optional `starts_at`/`ends_at`, `is_active`
- **`app_config`** — singleton `id=1`: `carde_poll_interval_ms` (default 30000), `pf_poll_interval_ms` (15000), `extension_logistics_threshold_min` (default 50)
- **`app_activity`** — audit log (`event_type`, `username`, `ip`, `user_agent`, `detail`, `created_at`)

### New / changed columns

- **`rounds.operator_notes`** — TEXT, local only, never synced externally
- **`app_tournaments`**: `event_id` (nullable FK), `timezone` NOT NULL (default `America/New_York`), `venue` nullable
- **`app_tournaments.is_test_tournament`** — used by seed, worker API skip, prod list filter

### Runtime config

- `src/services/appConfig.ts` — load/cache/update singleton, validation (poll 5s–300s, logistics 1–180 min)
- `src/server.ts` — `await loadAppConfig()` before `listen()`; worker uses `getAppConfig()` for poll intervals (**changing config in UI requires API restart to respawn worker timers**)

---

## Backend — new modules

| Path | Role |
|------|------|
| `src/lib/logger.ts` | `LOG_LEVEL`-gated logging |
| `src/services/healthStatus.ts` | `buildHealthStatus()` for `/api/health` |
| `src/services/auditLog.ts` | `app_activity` + `auditFromRequest` / `auditPublicRequest` |
| `src/services/appConfig.ts` | Poll intervals + logistics threshold |
| `src/utils/validation.ts` | Username, password 6–128, Carde ID, PF UUID |
| `src/utils/timezone.ts` | IANA validation for admin |
| `src/ingestion/backfillFromRaw.ts` | Rebuild normalized from latest raw rows (no API) |
| `src/api/eventTypes.ts` | `AppEventSummary` for admin events API |
| `src/routes/config.ts` | Public `GET /api/config` |
| `src/routes/sync.ts` | Admin-only sync + backfill |

### `src/server.ts`

- `GET /api/health` — unauthenticated; 503 if DB down
- Mounts: `configRouter`, `syncRouter` (behind auth)
- Global error handler uses `logger.error`
- Boot: `loadAppConfig()` → `listen()` → `startWorker()`

### `src/ingestion/worker.ts` changes

- Poll intervals from `getAppConfig()`
- Match sync errors via `logger.error` (not `console.error`)
- Skips Carde/PF API calls for `isTestTournament` tournaments (existing)

### `src/routes/serializers.ts` changes

- Tournament: `event`, `timezone`, `venue`, `game`, `sources.{pf,carde}`
- **`serializeAdminTournament()`** — includes `sourceMappings: { source, externalId, isEnabled }[]`
- Round: `operatorNotes`
- `serializeAppEvent()` for events list

---

## API surface (full matrix)

### Session (`src/routes/session.ts`)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/login` | Rate-limited; `login_failed` audit |
| POST | `/api/logout` | |
| GET | `/api/me` | |
| POST | `/api/session/pf-jwt` | Admin+ |
| GET | `/api/session/pf-jwt` | Status only (`inMemory`, `expiresAt`, `setBy`) — never returns token |
| DELETE | `/api/session/pf-jwt` | Admin+ clear |

### Tournaments (`src/routes/tournaments.ts`)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/end-tournament` | admin+ | Freeze `isEnded` |
| GET | `/api/games` | auth | Games + default round length |
| GET | `/api/tournaments` | auth | **Production filters out `isTestTournament`** |
| GET | `/api/tournaments/:id` | auth | |
| GET | `/api/rounds` | auth | |
| GET | `/api/dashboard/active-round` | auth | |
| GET | `/api/logs` | auth | |
| GET | `/api/insights` | auth | `overtimeMinutes` always `null` (by design until Phase 2) |
| PATCH | `/api/rounds/:id/notes` | admin+ | Max 2000 chars |
| GET | `/api/worker-status` | auth | |
| GET | `/api/data/:table` | auth | Paginated Data tab |

### Public config

| GET | `/api/config` | `{ extensionLogisticsThresholdMin }` for Insights |

### Sync (`src/routes/sync.ts`) — **all `requireAdmin`**

| Method | Path | Body | Behavior |
|--------|------|------|----------|
| POST | `/api/sync` | `{ tournamentId, sources? }` | `syncCardeRounds` / `syncPfData`; **409 if tournament not active**; audit `manual_sync` |
| POST | `/api/backfill` | `{ tournamentId }` | `backfillTournamentFromRaw`; works on any existing tournament; audit `tournament_backfill` |

### Reports (`src/routes/reports.ts`) — admin+

| GET | `/api/reports/round-timing` | |
| GET | `/api/reports/round-timing/export` | CSV |

### Admin (`src/routes/admin.ts`) — **all `requireSuperadmin`**

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST/PATCH/DELETE | `/api/admin/events` | Events CRUD; PATCH can cascade timezone to linked tournaments |
| POST | `/api/admin/reset-test-tournament` | **Non-prod only**; body `{ scenario? }` |
| GET/PATCH | `/api/admin/config` | Poll intervals + logistics threshold |
| GET | `/api/admin/activity` | Last 100 audit rows |
| GET/POST/PATCH | `/api/admin/users` | Create; PATCH supports **`password` reset** |
| GET/DELETE | `/api/admin/sessions` | Revoke |
| GET/POST/PATCH/DELETE | `/api/admin/tournaments` | Full lifecycle; POST **rejects `isTestTournament` in body** |
| PATCH | `/api/admin/tournaments/:id/sources` | Toggle `isEnabled`, update `externalId` (validated) |
| POST | `/api/admin/staff-sync` | PF staff upsert (needs JWT in memory) |

### Health

| GET | `/api/health` | No auth — `{ ok, uptime, db }` only |
| GET | `/api/admin/health` | Superadmin — workers + PF JWT metadata |

### Not implemented (Phase 3)

| GET | `/api/admin/backup` | PostgreSQL dump stream |

---

## Audit event types

See `AuditEventType` in `src/services/auditLog.ts` — includes `pf_jwt_set`, `pf_jwt_cleared`, `staff_sync`, `tournament_ended`, `tournament_reactivated`, etc.

Verify admin/sync actions actually write audit rows.

---

## `backfillFromRaw.ts` — review priority

Rebuilds normalized tables from **latest raw row per dedupe key** (no external API):

| Entity | Dedupe key | Notes |
|--------|------------|-------|
| Carde rounds | `carde_round_id` | Write-once `startedAt`/`completedAt` like worker |
| Carde matches | `carde_match_id` | Skips `tableNumber === -1`; `timeExtensionSec=0` if PF enabled |
| PF drops | `playerGameId + round` | Preserves `isChecked` write-once |
| PF extensions | `pf_id` | Links `roundId` when round exists |
| PF penalties | `pf_id` | Upsert |
| PF coverage | `tableNumber + coveredBy` | |
| PF judge calls | `table + round + judgeResult` | **Insert-only if missing** |

**Review questions:** Judge-call insert-only correct? Backfill on ended tournaments while sync requires active? Drift vs `worker.ts` normalize paths?

---

## Frontend — new files (untracked)

### Manage (`client/src/components/manage/`)

| File | Purpose |
|------|---------|
| `ManageTab.tsx` | Superadmin gate |
| `OpsChecklistPanel.tsx` | Polls `/api/admin/health` |
| `ToolsPanel.tsx` | Manual sync + backfill |
| `ConfigPanel.tsx` | Poll intervals, logistics threshold, **hide TEST tournaments** |
| `EventsPanel.tsx` | Events CRUD |
| `TournamentPanel.tsx` | Create/edit tournaments, source toggles, external IDs, end/deactivate, test reset + scenario |
| `UsersPanel.tsx` | Create users, role edit, **reset password**, deactivate |
| `SessionsPanel.tsx` | List + revoke |
| `ActivityPanel.tsx` | Audit table |
| `ManageTab.css` | Styles |
| `client/src/api/adminTypes.ts` | Admin API types |

### Insights / utils

| File | Purpose |
|------|---------|
| `RoundOperatorNotes.tsx` | Inline notes → `PATCH /api/rounds/:id/notes` |
| `RoundComparePanel.tsx` | QoL 2 — compare two rounds + deltas |
| `roundSummaryText.ts` | QoL 9 — copy round summary for Slack/Discord |
| `extensions.ts` | QoL 1 — logistics filter helpers |

### Logs

| File | Purpose |
|------|---------|
| `LogsDiffBanner.tsx` | QoL 13 — delta counts between polls |
| `logEntryTime.ts` | Entry keys/timestamps |

### Layout / hooks

| File | Purpose |
|------|---------|
| `tabBarUtils.ts` | Tab order for keyboard shortcuts |
| `GuidePanel.tsx` | QoL 11 — shortcuts + test scenarios help |
| `constants/timezones.ts` | IANA list for Manage |
| `useLogsBadge.ts` | Logs tab badge while off-tab |
| `useTabKeyboard.ts` | `1–N`, `F`, `Ctrl+Enter`, `Esc` |
| `useRoundPace.ts` | Pace badge timer hook |
| `roundPace.ts` | `getRoundPace()` logic |

### CI

| `.github/workflows/deploy.yml` | typecheck, lint, build, SSH deploy, `prisma migrate deploy`, systemd restart |

---

## Frontend — modified behavior

### `App.tsx`

Tabs: dashboard, logs, insights, **guide**, reports (admin+), session (context gear), data, manage (superadmin+). Wires `useLogsBadge`, `useTabKeyboard`, `DashboardRoundProvider`, `LogFeed` with `isTabActive` + search focus ref.

### `TournamentContext.tsx`

- Sort tournaments: active first, ended last
- `hideTestTournaments` via localStorage `hide_test_tournaments`
- `refreshTournaments()` + `tournaments:refresh` event (Manage source toggles dispatch this)
- Re-fetch on `auth:login`

### Timezone (`client/src/utils/time.ts`)

`formatInTournamentTz`, `formatTzAbbrev` wired in LogEntry, RoundTimer, ActiveRound, RoundSchedulePane, ContextBar, ReportsTab, round summary.

### Dashboard

- `RoundStrip` — pace badges via `useRoundPace`
- `ActiveRound` — error Banner when live round >15m past `timer_end_datetime`
- Round selector pills + schedule click sync (`DashboardRoundProvider`)

### Insights

- Logistics exclusion in totals (**QoL 1**)
- Expandable rows: histogram (**QoL 4**, 2+ ops extensions), outstanding tables, operator notes, Copy
- `RoundComparePanel` above main table
- Pace in status column

### Logs

- Collapsible rounds; latest expanded; per-tournament localStorage (**QoL 7**)
- Presets: This round / Extensions / Drops / Penalties / Clear (**QoL 8**)
- Filter persistence `logs-filter-{tournamentId}` (**QoL 12**)
- Poll interval 15/20/30/60s
- Highlight new entries (`.log-entry--new`) off-tab
- Tab badge

### Session

- Warning if JWT not `inMemory` (post-restart)
- DevTools JWT extraction guide
- Shows `setBy`

### Context bar

- TZ abbrev in multi-tournament select options

### Tab bar

- Guide tab, logs badge, dynamic visible tabs via `tabBarUtils`

### Types

`client/src/api/types.ts` kept in sync with `src/api/types.ts` (event, timezone, operatorNotes, etc.).

---

## Test tournament system

- `seedTestTournament(scenario)` in `src/db/seed-test-tournament.ts`
- npm scripts: `db:seed-test`, `db:seed-test:late`, `:overtime`, `:top8`
- Scenarios: **default** (R5 ~40m left), **late** (~2m), **overtime** (expired + missing tables), **top8** (R6 null timer)
- Manage reset posts `{ scenario }` to `/api/admin/reset-test-tournament` (non-prod)
- Worker skips external APIs for test tournaments

---

## QoL status (`plans/qol.md`)

| # | Item | Shipped? |
|---|------|----------|
| 1 | Logistics extension filter | Yes |
| 2 | Round compare | Yes (duration `n/a`) |
| 3 | Round pace indicator | Yes |
| 4 | Extension histogram | Yes (2+ ops) |
| 5 | Logs tab badge | Yes |
| 6 | Operator notes | Yes |
| 7 | Collapsible log rounds | Yes |
| 8 | Filter presets | Yes |
| 9 | Copy round summary | Yes |
| 10 | Trend table | Yes (Insights table; overtime `n/a`) |
| 11 | Keyboard shortcuts + Guide | Yes |
| 12 | Filter persistence | Yes (filter + collapse + poll interval) |
| 13 | Diff banner | Yes |

---

## Phase 1 sections

| Section | Status |
|---------|--------|
| 1.1 Admin API | Complete except backup (P3) |
| 1.2 Events + timezone | Complete |
| 1.3 Worker | Complete (poll from config) |
| 1.4 Manage tab | Complete |
| 1.5 Ops (logger, health, checklist) | Complete |
| 1.6 CI/CD | Complete |
| 1.x Test tournaments | Complete |

---

## Domain / security — verify

1. Never use Carde `completed_at` for duration/overtime.
2. PF extensions: match `timeExtensionSec=0` when PF enabled; backfill matches worker.
3. Top-8: null `timer_end_datetime` — pace/histogram must not crash.
4. JWT never in API responses; `inMemory` surfaced correctly.
5. `requireSuperadmin` on `/api/admin/*`; `requireAdmin` on sync/backfill/notes/reports/end-tournament.
6. Prod hides test tournaments from `GET /api/tournaments`.
7. Validation on users/passwords/external IDs.
8. Session list excludes `token` from Prisma select.
9. User deactivate deletes sessions in transaction.
10. Write-once semantics in backfill vs worker (drops, round timestamps).

---

## Manual test plan (~90 min)

1. `npx prisma migrate deploy` (stop dev server first) + `npm run db:seed-test:overtime`
2. Superadmin → Manage: event, tournament, sources, config, Tools sync/backfill → Activity log
3. Paste PF JWT → checklist green
4. Dashboard: overtime alert + pace badge
5. Insights: compare rounds, copy summary, operator notes
6. Logs: presets, collapse, diff banner, badge from dashboard, `F` key
7. Manage: disable PF → UI hides PF columns without full reload (`tournaments:refresh`)
8. Hide TEST tournaments in config → gone from selector
9. `npm run db:seed-test:top8` → no timer pace on R6
10. Create admin user, reset password, confirm 403 on admin routes as non-superadmin
11. `NODE_ENV=production`: test tournaments absent from list API

---

## Deepest review targets (ordered)

1. `src/routes/admin.ts`
2. `src/ingestion/backfillFromRaw.ts`
3. `src/routes/sync.ts`
4. `src/routes/tournaments.ts`
5. `src/routes/serializers.ts`
6. `client/src/context/TournamentContext.tsx`
7. `client/src/components/manage/TournamentPanel.tsx`
8. `client/src/components/logs/LogFeed.tsx`
9. `client/src/hooks/useTabKeyboard.ts`, `useLogsBadge.ts`
10. `src/db/seed-test-tournament.ts`
11. `.github/workflows/deploy.yml`

---

## Known limitations (not P1 blockers)

- Migrate advisory lock if dev server holds DB connection
- Poll interval changes apply immediately to running workers (`rescheduleActiveTournamentPolls` on config PATCH)
- Seed script uses `logger` (no lint `no-console` warnings)
- Backfill judge calls insert-only
- Duration/overtime metrics need Phase 2 `result_at` / StageTimer
- No CI smoke test against seed yet
- Tournament reactivate via Manage → Reactivate (`PATCH` sets `isActive` + clears `deletedAt`; worker respawns)

---

## Deliverables expected from reviewer

1. **Blockers** (security, data loss, auth)
2. **Should-fix before merge**
3. **Nice-to-have / defer to Phase 2**
4. Whether `plans/phase-1.md` and `plans/qol.md` match code
5. Whether deploy/migration steps are sufficient

---

## Agent review prompt (copy-paste)

Use this block as the full handoff for another agent. Branch: **`hz/random-v2`**. Commits: **`f46b5b6`** (Phase 1) + **`5ed2538`** (UTC timestamps). Base: `a3a6b3b`.

```markdown
# pf-logger — branch review: `hz/random-v2`

## Mission
Review commits `f46b5b6` + `5ed2538` (base `a3a6b3b`) for merge readiness to `main`. Focus on security, data correctness, domain invariants, and deploy/ops runbook. Tournament ops dashboard: PurpleFox + Carde.io → PostgreSQL → React.

## Read first
| Doc | Why |
|-----|-----|
| `CLAUDE.md` | Domain invariants, phase status |
| `agent/RULES.md` | Style, UTC/health/VPS rules |
| `agent/MEMORY.md` | 2026-06-02 session log |
| `plans/phase-1.md` | P1 scope (WRAPPED) |
| `plans/qol.md` | QoL 1–13 status |
| `plans/p1-review-handoff.md` | This file — detailed checklist |
| `docs/DEPLOY.md` | § Timestamps (UTC storage and display) |

## Verify locally
npm run db:generate
npm run typecheck
npm run lint
npm run build
node scripts/apply-pending-migrations.cjs --dry-run

Migrations to confirm on target DB:
- 20260601120000_add_games
- 20260601_add_test_tournament_flag
- 20260602120000_add_operator_notes
- 20260602140000_events_and_timezone
- 20260602160000_app_config

---

## Summary of changes

### Commit 1: `f46b5b6` — Complete Phase 1 (~98 files)

**Backend**
- Superadmin **Manage API**: tournaments (CRUD, sources, reactivate), users (incl. last login, password reset), sessions, events, config, activity, staff-sync, reset-test-tournament
- **Health split**: `GET /api/health` → `{ ok, uptime, db }` only; `GET /api/admin/health` → workers + PF JWT (superadmin)
- **Worker lifecycle**: `stopTournamentWorker` on deactivate/end/delete; respawn on reactivate; `rescheduleActiveTournamentPolls` on config PATCH
- **Backfill** (`src/ingestion/backfillFromRaw.ts`) + `POST /api/backfill` aligned with worker normalization
- **Guards**: prod hides test tournaments (`tournamentAccess.ts`); `PF_PASSWORD_PEPPER` required in production
- **Audit** (`auditLog.ts`): typed events incl. `pf_jwt_set/cleared`, `staff_sync`, `tournament_*`, `manual_sync`, etc.
- **Rate limit** on sync; `src/lib/logger.ts` with `LOG_LEVEL`
- **Migrations**: operator notes, app_events + tournament timezone/venue, app_config singleton

**Frontend**
- Full **Manage** tab: Tournaments, Users, Sessions, Events, Config, Tools, Pre-event checklist, Activity
- **QoL 1–13**: logs badge, keyboard shortcuts, Guide tab, round compare (duration `n/a`), operator notes, copy summary, extension histogram, collapsible logs, filter presets, diff banner, etc.
- Events/timezone inherit; `formatInTournamentTz` on logs/dashboard/schedule
- TournamentPanel: timezone/venue prompts, reactivate, end tournament

**Ops**
- `.github/workflows/deploy.yml` (typecheck, lint, build, SSH deploy)
- `scripts/apply-pending-migrations.cjs` (initial)
- `npm run db:apply-pending` in package.json

**Docs**
- `plans/phase-1.md` WRAPPED; `CLAUDE.md` → Phase 2; `plans/qol.md`, `plans/p1-review-handoff.md` synced

**Explicitly NOT shipped**: `GET /api/admin/backup` (Phase 3). QoL 2/10 duration columns until Phase 2 `result_at`/StageTimer.

### Commit 2: `5ed2538` — UTC storage + client display (16 files)

**Ingestion (`src/utils/datetime.ts`, `worker.ts`)**
- `parseCardeTimestamp(value, tournament.timezone)` — naive Carde ISO → UTC instant using IANA zone
- `parsePfTimestamp` — PF strings without suffix treated as UTC
- Worker round/match/extension/penalty sync uses parsers (not raw `new Date(string)`)

**API**
- Unchanged contract: all timestamps still `Date.toISOString()` (`…Z`)

**Client (`client/src/utils/time.ts`, `datetime.ts`)**
- `formatInTournamentTz` — tournament UI (logs, dashboard, schedule, reports)
- `formatUtc` / `formatUtcDateTime` — Manage users/sessions/activity labeled **(UTC)**
- Reports `formatReportValue` uses shared formatter

**Deploy / CI**
- `docs/DEPLOY.md`: **Timestamps** section; post-deploy **sync per tournament** (not backfill-only); `db:apply-pending --dry-run`; P1002 guidance
- `apply-pending-migrations.cjs`: auto-discovers all migration folders, SHA-256 checksums, `--dry-run`
- `deploy.yml`: on Prisma **P1002 only**, fallback to `npm run db:apply-pending`

**Docs / agent**
- `docs/carde-api.md`: timer_end_datetime not recoverable for completed rounds; matches-list pagination notes
- `CLAUDE.md`, `agent/RULES.md`, `agent/MEMORY.md`: UTC pipeline + health + VPS DB access rules

---

## Review focus areas

### Security
- Public `/api/health` must not leak JWT or per-tournament worker details
- Admin routes superadmin-gated where required; session list excludes tokens
- Prod test-tournament 404 on tournament-scoped routes
- No secrets in committed files

### Domain invariants (must not regress)
- `completed_at` ≠ round end time (equals next round `started_at`)
- PF+Carde: extensions from PF only; Carde `time_extension_seconds` = 0
- Outstanding tables include extension tables
- Top-8: null-check `timer_duration_minutes`
- PF JWT memory-only; `inMemory: false` after restart

### UTC correctness (commit 2)
- Carde strings with offset vs naive — correct UTC in DB?
- `wallTimeInZoneToUtc` edge cases (DST)?
- Existing rows wrong until **manual sync** — is DEPLOY.md accurate?
- Any remaining `toLocaleString()` without explicit `timeZone`?

### Worker / backfill parity
- `backfillFromRaw.ts` vs `worker.ts` for drops, matches, `inferRoundPhase`
- Worker stop/start on tournament lifecycle events

### Phase 1 completeness
- `plans/phase-1.md` vs code
- QoL matrix vs `plans/qol.md`

### Deploy
- CI migrate + P1002 fallback safe?
- VPS steps: migrate → restart → PF JWT paste → per-tournament sync

## Deliverables
1. **Blockers** (security, data loss, auth bypass)
2. **Should-fix before merge**
3. **Nice-to-have / Phase 2**
4. Confirm both commits safe to merge as-is or recommend split/reorder
5. Post-merge VPS checklist (migrations, sync, smoke tests)
```
