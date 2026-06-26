# Agent Rules

Behavioral rules, corrections, and strong preferences extracted from past sessions. Agents must read this at the start of any session. Updated by the consolidation skill — do not edit manually unless correcting a stale rule.

Rules are organized by topic. Each rule leads with the behavior, followed by **Why:** and **When:** lines where relevant.

---

## Communication style

- Keep responses short and direct. Avoid trailing summaries of what was just done.
- Do not narrate internal deliberation or explain what you're about to do at length — just do it.
- When referencing code, include file path and line number so the user can navigate directly.

## Code changes

- Do not add features, abstractions, or cleanup beyond what was explicitly asked.
- Do not add comments unless the WHY is non-obvious.
- Never add emojis to files or responses unless explicitly asked.

## Code style (enforced by ESLint + Prettier — `npm run lint` and `npm run format`)

**Formatting:**
- Tab width: **4 spaces** (not 2). Print width: 120.
- Single quotes for JS/TS strings. Double quotes for JSX attributes (`jsxSingleQuote: false`).
- Trailing commas everywhere. `arrowParens: always`.
- Run `npm run format` after any batch of edits. Run `npm run lint` before considering a task done.

**Null / equality checks:**
- Always use `===` / `!==`. Never `==` / `!=`. The `eqeqeq: error` rule enforces this.
- Null guard pattern: use explicit `=== null` or `!== null`, not truthiness (`!x` or `x &&`). When checking a nullable type for both null and a property value, split into two separate `if` statements — don't combine into one compound `||` expression that spans the null guard and the property access (this triggers `prefer-optional-chain`).

**Async patterns:**
- A promise-returning function passed as a void callback (setInterval, onClick, etc.) must be wrapped: `() => { void fn(); }`.
- A standalone floating promise call must use `void fn()`.
- Async functions with no `await` expression must drop the `async` keyword (`require-await` rule).
- Do not pass `async` functions directly to `onSubmit`, `onClick`, or other void-typed event handlers — wrap them.

**TypeScript:**
- Prefer `interface` over `type` for object shapes (`consistent-type-definitions` rule).
- Use optional chaining (`?.`) and nullish coalescing (`??`) — `prefer-optional-chain` and `prefer-nullish-coalescing` are errors.
- No `any` without an eslint-disable comment explaining why.
- Return types are required on backend functions (`explicit-function-return-type: warn`); omitted on frontend components/expressions.
- When stringifying `unknown` values, do not use `String(value)` directly — narrow the type first: handle `null`/`undefined` → `''`, `string` → passthrough, `number`/`boolean`/`bigint` → `String(value)`, everything else → `JSON.stringify(value)`.

**General:**
- Use `object-shorthand` — `{ foo }` not `{ foo: foo }`.
- `prefer-const` is enforced; never use `var`.

## File and doc edits

- When editing agent docs (`agent/*.md`), preserve the user's formatting style — extra blank lines between list items, etc. Do not revert formatting changes.
- Do not rewrite sections the user has already edited in the same session. If a system reminder says a file was modified, read it before touching it again.
- Do not create markdown files unless explicitly requested.
- After shipping multi-area work in one session, update `plans/` (especially `phase-1.md` shipped table) and `docs/DEPLOY.md` if dev or deploy behavior changed.

## UI implementation docs

- **`plans/ui-implementation.md`** = what to build (behavior, layout, checkpoints). **`plans/ui-code-patterns.md`** = concrete code patterns. Do not duplicate full implementations in both.
- Write implementation docs for TS-experienced readers — skip React basics and beginner scaffolding.
- **Figma sync:** `client/src/styles/tokens.css` is visual truth; `plans/ui-implementation.md` is behavioral truth. Agents read those files, not Figma directly.
- Never animate data values (counts, timer ticks, poll results) — only structural UI transitions.
- All interactive targets **44px** minimum height — verify on new components (FilterChip was a past violation at 36px).
- **Badges** are pill-shaped and informational only; **buttons/CTAs** are rectangular (`radius-md`) with verbs — never pill-shaped actions.

## Dashboard and reports UI

- **Reports tab:** `admin` / `superadmin` only; full-width main content — **no** `IndicatorsLayout` sidebar.
- **Dashboard round selection:** `DashboardRoundProvider` wraps the dashboard tab in `App.tsx` only. `RoundSchedulePane` rows are clickable when the provider is present; selection syncs with Live / R# pills in `ActiveRound`.
- Round timing report **"last table finished"** source is `rounds.last_match_completed_at` — NOT `matches.result_at`. `result_at` equals `updated_at` (stale fetch timestamp) for in-progress matches and is unreliable. The worker stamps `last_match_completed_at` with wall-clock time when `stillInProgress === 0`. `src/services/roundTimingReport.ts` currently uses `matches.result_at` and needs to be updated.
- Round timing report **play start** is `rounds.play_started_at` (set by worker when timer end is known; equals `timer_end_datetime − game.default_round_length_min`). **NEVER use `timer_duration_min` from Carde for this** — it can be stale/wrong (e.g. `timer_duration_min = 16` on a 60-min round). The game's `default_round_length_min` is the ground truth. Fall back to `started_at` only when `play_started_at` is null.
- Round timing report **scheduled end** priority: `COALESCE(timer_end_datetime, play_started_at + duration, started_at + duration)`. Always prefer the stored `timer_end_datetime` — `timer_duration_min` can be stale or wrong relative to the actual timer set. Never override the stored value with a recomputed one.
- `timer_end_datetime` must be captured **live** per round by the ingestion worker. It is **not recoverable from Carde for completed events**: round objects carry only `started_at` / `timer_duration_minutes` / `completed_at`; the event `detail/` endpoint keeps only the single last timer state at close; no round-detail or timer/audit-log endpoint exists (all 404). Events never ingested have no recoverable per-round scheduled end.
- **Seating turnover** = `play_started_at − started_at`. Null if `play_started_at < started_at` (data anomaly — clock pressed before pairings published).

## Local development

- `npm run dev` starts the API first; Vite waits on `wait-on tcp:127.0.0.1:$PORT` via `scripts/start-client.cjs`. Open the **Vite** `Local:` URL in dev, not `:8080` directly.
- Vite's `/api` proxy reads `PORT` from the **repo root** `.env` (`loadEnv` in `client/vite.config.ts`) — must match the Express listen port.
- `ECONNREFUSED` on `/api/*` at startup usually means the API is still compiling or `PORT` mismatch — not a broken route.

## Prisma / migrations

- `prisma.config.ts` must include `datasource.url` (from `DATABASE_URL`) for `prisma migrate` to work.
- Migration **folder names** must sort lexicographically **after** any migration they depend on — on Windows the shadow DB applies folders in name order, not creation order.
- **Prisma 7 import path:** import `PrismaClient` and `Prisma` from `'../generated/prisma/client'` — NOT `'@prisma/client'`. The `prisma-client` generator outputs TypeScript to `src/generated/prisma/` (gitignored).
- **Prisma 7 JSON columns:** `Record<string, unknown>` is not assignable to `InputJsonValue`. Use `JSON.parse(JSON.stringify(value))` to produce a plain JSON-safe value.
- **Advisory lock timeout:** `prisma migrate` times out when another process holds a Prisma connection (e.g., dev server). Apply SQL manually via psql + `INSERT INTO _prisma_migrations` to mark resolved.
- `table_judge_calls` must NOT have a unique constraint on `(tournament_id, table_number, round)` — a table can have multiple judge calls per round.

## Memory and context

- Always check `agent/RULES.md` and `agent/MEMORY.md` at the start of a session for behavioral context.
- Write session memory files during the session, not only at the end — checkpoints matter.
- When consolidating, do not delete session files from the memory folder.

## Tool use

- Use dedicated tools (Read, Edit, Grep, Glob) over Bash for file operations.
- Run independent tool calls in parallel.
- Do not re-read a file immediately after writing it to verify — trust the write succeeded.

## Domain-specific

- "Timer app" always means **StageTimer** — never use the generic term in docs or responses.
- Extensions in **PF+Carde mode** come from PurpleFox `tournament_logs` only — Carde `time_extension_seconds` is always 0 for our events in this mode. In **Carde-only mode**, use `time_extension_seconds` from Carde match objects (integer seconds).
- `completed_at` in Carde.io equals the next round's `started_at` for Swiss rounds — never use it as "round end."
- Outstanding tables include tables with extensions — extensions do not exempt a table from the count.
- Byes (`table_number = -1` in Carde) must not be counted as outstanding tables.
- Top-8 rounds have `timer_duration_minutes = NULL` — always null-check before computing timing metrics for any round.
- `is_ghost_match` from Carde is informational only — ghost marking may happen outside Carde and will not be reflected there.
- PF users are **staff** (judges/scorekeepers), not players. Never conflate `pf_staff` with players or `app_users`.
- Player names and IDs come from Carde match records. `user_identifier` in Carde is a **display name string** (e.g. `"Aldo M"`), not a UUID or gameId. Use `player_match_relationships[].user_event_status.user.id` (integer) as the stable player identifier.
- `status=in_progress` on `matches-list/` is confirmed functional — the ingestion worker uses this and never fetches full match lists.
- `table_coverage` (judge visited) and `table_judge_calls` (outcome of formal call) are distinct concepts — never merge them. Both come from the PF `tables` table (`coveredBy` and `judgeResult` columns). The `tables` table is **current-round-only** — wiped on every round advance.
- PF `tables`, `table_status`, and `tournament_time` hold **current round data only** — fully wiped on every round advance. Never treat an empty response from these tables as "no activity." Historical data does not exist in PF for these tables.
- PF drops are in `tournament_drops` (not `drops`). PF penalties are in `tournament_penalities` (extra 'i' — typo is real). Both accumulate across rounds and are NOT wiped on round advance.
- PF `tournament_logs` extensions have a `round` column — attribution by round does NOT require timestamp cross-referencing against Carde round windows. Use `round` directly.
- PF **has no persistent audit log** for round-start or bulk actions ("who started this round", "who marked all tables done"). `tournament_logs` contains extension entries only — no other action types exist in it. `tournament_time` records the clock-start timestamp but has no author field, and is current-round-only (wiped on advance). `table_status.updated_status_by` is a display name (not UUID) and current-round-only. "Who did X" for these actions is not recoverable.
- PF `judgeResult` on the `tables` table is **free-text**, not an enum. Do not match against fixed strings like "Warning" or "Game Loss" — those are penalty sanctions on a different table.
- `timer_is_running` in Carde does NOT flip to false when the round clock expires. Detect expiry by comparing `timer_end_datetime` (from `v2/organize/events/{id}/detail/`) against wall time.
- Carde round `status` values are `UPCOMING`, `IN_PROGRESS`, `COMPLETE`. There is no `ACTIVE` or `SCHEDULED` status.
- Carde round objects do NOT have `extra_time_seconds` or `additional_time_seconds` fields. These do not exist. Round-level timer adjustments are made via `edit_current_round_timer` and reflected only in `timer_end_datetime` on the event-level `detail/` endpoint.
- `timer_end_datetime` lives on `GET /api/v2/organize/events/{id}/detail/` — NOT on round objects from `get_all_rounds` or `tournament_overview`. It is also returned by `edit_current_round_timer` responses.
- Default page size for Carde `matches-list` is **25**, not 50. Always use `page_size=200` to fetch all matches in one call.
- **Carde `next` pagination type differs by endpoint:** `registrations-slim` and unfiltered `matches-list` return `next` as a **numeric page number** (e.g., `2`). The `status=in_progress` matches-list returns `next` as a **URL string**. Never pass `next` to `cardeGet()` when it could be a number — always use an explicit `page` counter with `&page=${page}` in the URL, and check only `next !== null` as a boolean to decide whether to continue.
- **Fixed seating / round-pairings detection:** to find which round currently has pairings, query `raw_carde_rounds WHERE pairings_status = 'GENERATED' ORDER BY round_number DESC`. Do NOT use `rounds.carde_status` for this — it stays `UPCOMING` until the timer starts, making it useless for the pairing-generated-but-timer-not-yet-started window. See `GET /api/fixed-seating` in `src/routes/tournaments.ts` for the implementation pattern.

## PF JWT management

- The PF JWT is **never** stored in the DB or `.env`. It lives in memory (`src/ingestion/jwtStore.ts`) only.
- `jwtStore.ts` is a **global singleton** — `getPfJwt()` takes no arguments. All PF tournaments share the same Supabase instance and therefore the same JWT. Do not add per-tournament JWT storage.
- `pf_session` table (singleton, `id=1`) stores only metadata: `set_by`, `set_at`, `expires_at`. Never the token.
- `GET /api/session/pf-jwt` returns `inMemory: boolean` — `false` after server restart, even if `expiresAt` is in the future. UI must prompt re-paste in this case.
- On JWT expiry mid-event, worker logs the failure and continues Carde-only. It does not crash or stop.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` go in `.env` (long-lived, public). `CARDE_API_TOKEN` goes in `.env`. PF JWT does not.

## Test tournaments

- Tournaments with `isTestTournament = true` must never trigger external API calls. The worker filters them out in `startWorker()` query AND both `syncCardeRounds()` / `syncPfData()` guard at the top.
- Test data is **local only** — never deploy test tournaments to the VPS.
- `npm run db:seed-test` is the dev fixture — idempotent, rebuilds with timestamps relative to now. Re-run to reset the live round timer.

## Standalone scripts that are also imported as modules

- Any TypeScript file that **exports functions** (imported by routes/services) AND runs as a **standalone CLI script** MUST guard its entry-point call with `require.main === module`:
  ```ts
  if (require.main === module) {
      main().catch((e) => { logger.error('...', e); process.exit(1); });
  }
  ```
- **Why:** Without this guard, the script's startup code (including DB transactions, `process.exit()`) runs every time Express imports the module — causing crash-restart loops on server start. This bit us in prod with `seed-test-tournament.ts` (165 systemd restarts, P2028 transaction timeout, persistent 502s; fixed in commit `342bacd`).
- **When to apply:** Any file in `src/db/` or `src/scripts/` that both exports named functions AND has a `main()` or top-level async IIFE.

## PF staff profiles

- PF `profiles` table is global (not per-tournament), ~2k rows. Fields: `{ id: UUID, firstname: string|null, lastname: string|null, colors: null }`.
- Fetch with `.range(from, to)` pagination, 1000 per page. Anon key alone is insufficient — requires user JWT.
- Display name = `[firstname, lastname].filter(Boolean).join(' ').trim()` — fall back to UUID if both null (~29 accounts).
- Staff sync runs on worker startup (auto-detects JWT) and via `POST /api/admin/staff-sync`. Covers all tournaments since PF is global.

## Architecture (current stack)

- The tool is being rewritten to TypeScript + Express + Prisma + PostgreSQL. Do not write or suggest Python code for new work.
- Schema is three layers: raw (verbatim API, append-only) → normalized (app queries) → app (`app_*`, tool-owned). See `docs/SCHEMA_DESIGN.md`.
- All timestamps are TIMESTAMPTZ (UTC storage). Ingest via `parseUtcTimestamp` / `parseCardeTimestamp` / `parsePfTimestamp` (`src/utils/datetime.ts`). API returns ISO UTC (`…Z`); UI converts with `formatInTournamentTz` (tournament) or `formatUtc` (Manage). Never use bare `toLocaleString()` / `toLocaleTimeString()` without an explicit `timeZone`.
- After deploys that change timestamp parsing, operators must **sync each active tournament** (Manage → Tools) to re-ingest from API — `POST /api/backfill` alone does not fix wrongly captured raw timestamps. See `docs/DEPLOY.md` § Timestamps.
- Migrations: prefer `npx prisma migrate deploy`; on **P1002** advisory lock locally or in CI, use `npm run db:apply-pending` (auto-discovers pending folders; `--dry-run` to preview).
- Health: public `GET /api/health` is `{ ok, uptime, db }` only; worker/JWT status is `GET /api/admin/health` (Manage checklist).
- VPS PostgreSQL: default is localhost-only. Prefer SSH tunnel for remote access; do not document or recommend opening port 5432 to `0.0.0.0/0`. If direct access is required, restrict to a single IP in `pg_hba.conf` (`ADDR/32`) and matching `ufw allow from ADDR`.
- `timer_end_datetime` is stored in the normalized `rounds` table. For IN_PROGRESS rounds the worker prefers the real value from `detail/` endpoint (reflects when TO pressed Resume); falls back to existing stored value, then to `started_at + timer_duration_min`. For COMPLETE rounds it is **write-once** — never overwrite with a recomputed value once the real timer end has been captured. The +7–83s lag between round creation and Resume press means the computed value is always too early.
- Carde-only mode: `tournament_source_mapping.is_enabled = FALSE` on the PF row. Worker skips all PF fetches. Extensions come from `time_extension_seconds` on Carde match objects. No drops, penalties, coverage, or judge calls.
- PF+Carde mode: extensions from PF `tournament_logs` only. Carde `time_extension_seconds` always 0 for our events.
