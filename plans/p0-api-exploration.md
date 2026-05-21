# P0 Step 2 — Live Event API Exploration

**Purpose:** Verify and fill all documented gaps in our Carde.io and PurpleFox knowledge during a live event.
Do this early in the day (Round 1–2) while data is actively flowing. Record responses and update
`agent/CARDE_IO.md` and `agent/PURPLEFOX.md` with confirmed behavior.

---

## Before the event

- [ ] Confirm `CARDE_API_TOKEN` is set in `.env` and valid (try any completed-event endpoint)
- [ ] Have a staff member ready to paste their PF JWT via the Session panel
- [ ] Have the `event_id` (Carde) and `tournament_id` (PF UUID) for the event

---

## Carde.io

**✅ Completed 2026-05-21 via live session (event 611916) + HAR analysis.**
Full confirmed schema in `agent/CARDE_IO.md`. Implementation reference in `docs/carde-api.md`.

### 1. `tournament_overview` — live structure

- [x] Confirmed 200 while active. Returns 404 for completed events (documented, not re-tested).
- [x] Full response shape documented — see `agent/CARDE_IO.md`
- [x] `current_round` object confirmed (id, round_number, status, pairings_status, standings_status)
- [x] `number_of_incomplete_matches` is the outstanding table count field
- [x] No `timer_end_datetime` — timer lives on `v2/organize/events/{id}/detail/` instead
- [x] No `timer_remaining_seconds` or any countdown field anywhere in the API

### 2. `get_all_rounds` — live round fields

- [x] No `timer_end_datetime` on round objects — confirmed absent
- [x] No `extra_time_seconds` or `additional_time_seconds` on round objects — neither field exists
- [x] Per-match extension is `time_extension_seconds` on match objects (seconds), not round-level
- [x] Round-level timer adjustments via `edit_current_round_timer` reflected only in `timer_end_datetime` on `detail/`
- [x] Active round `status` is `IN_PROGRESS` (not `ACTIVE` as previously assumed)
- [x] Status values observed: `UPCOMING`, `IN_PROGRESS`, `COMPLETE`
- [x] `pairings_status` values: `NOT_GENERATED`, `GENERATED`
- [x] `timer_duration_minutes` is null on active round until `edit_current_round_timer` sets it
- [x] Top-8 not tested (test event was 3-round Swiss only)

### 3. `matches-list` — outstanding table filter

- [x] `status=in_progress` confirmed working ✓
- [x] `avoid_cache=true` accepted, no errors ✓
- [x] All fields confirmed: `time_extension_seconds`, `result_reported_at`, `is_ghost_match`, `assigned_judge`, `player_match_relationships` ✓
- [x] `result_reported_at` is null for in-progress matches ✓
- [x] Draw confirmed: `result_reported_at` null, `match_is_intentional_draw: true`, `updated_at` non-null ✓
- [x] `user_identifier` is a display name string e.g. `"Aldo M"` — NOT a UUID or gameId
- [x] `table_number: -1` — not observed in in_progress results (byes auto-resolve)

### 4. Pagination

- [x] Default page size is **25** (not 50 as assumed)
- [x] `ordering=table_number` confirmed working ✓
- [x] `page_size=200` works — returns all matches in one call ✓

### 5. Event completion boundary

- [ ] Not tested in this session (test event not completed through Top 8)

---

## PurpleFox

**✅ Completed 2026-05-21 via Claude in Chrome session + HAR analysis.**
Full confirmed schema in `agent/PURPLEFOX.md`. Summary of findings below.

All PF calls go through Supabase REST: `GET {SUPABASE_URL}/rest/v1/{table}?...`
Auth: `apikey: {SUPABASE_ANON_KEY}`, `Authorization: Bearer {JWT}`

### 6. Drops table

Table: ~~`drops` (assumed)~~ → **`tournament_drops`**

- [x] Confirm exact Supabase table name — `tournament_drops` (`drops` → 404)
- [x] List all columns — `tournamentId`, `playerGameId`, `tableNumber`, `round`, `playerName`, `isChecked`, `isCancelled`, `updated_by`, `updated_by_name`
- [x] Confirm: `tableNumber` ✓, `round` ✓, `isChecked` ✓, `tournamentId` ✓
- [x] Staff column — no `droppedBy`/`staffName`; actual: `updated_by` (UUID) + `updated_by_name` (display name string)
- [x] `isChecked` is a **boolean**, not 0/1
- [x] No `createdAt` or `updatedAt` — **no timestamp on drops at all**
- [x] `tournamentId=eq.{uuid}` filter confirmed working

### 7. Extensions — `tournament_logs`

- [x] Table name confirmed: `tournament_logs`
- [x] Columns: `id` (integer), `tournamentId`, `tableNumber`, `round`, `action`, `userId`, `createdAt`
- [x] Action format confirmed: `"Change time from Xmin to Ymin"` — no variation observed
- [x] `tableNumber` is a **direct column** (no join needed)
- [x] `round` is a **direct column** — previously thought absent, it's present ✓
- [x] No `staffName` — only `userId` (UUID FK to `profiles.id`); use `?select=*,profiles(firstname,lastname)` for name
- [x] `createdAt` is UTC with `+00:00` suffix confirmed
- [x] `action=like.Change*` filter confirmed working; all rows are extension entries

### 8. Penalties — `tournament_penalities` (typo)

- [x] Table name confirmed: `tournament_penalities` (extra 'i') — `tournament_penalties` → 404
- [x] Columns: `id` (uuid), `tournamentId`, `round`, `playerGameId`, `playerName`, `type`, `sanction`, `description`, `creator_id`, `creator_name`, `createdAt`
- [x] No `tableNumber` column — penalties not linked to a table
- [x] No `remedy` or `infraction` — use `type` (infraction category) and `sanction` (outcome)
- [x] No `staffId` — use `creator_id` (UUID) + `creator_name` (string)
- [x] Player name: `playerName` column ✓ (denormalized)
- [x] Free-text notes: `description` column ✓
- [x] `createdAt` has **no timezone suffix** (inconsistent with `tournament_logs`); treat as UTC

### 9. Table coverage + Judge results

Table: ~~`table_coverage` (assumed)~~ → **`tables`** (coverage and judge results on same row)

- [x] `table_coverage` → 404, `table_judge_results` → 404. Both live on `tables` table
- [x] Columns: `tournamentId`, `tableNumber`, `playerGameId1/2`, `playerName1/2`, `playerScore1/2`, `result`, `coveredBy`, `judgeResult`, `isAtStage`, `isFeature`
- [x] `coveredBy` is a display name string, not a UUID ✓
- [x] No round column — `tables` is current-round-only, wiped on round advance
- [x] One row per (tournamentId, tableNumber) — coverage and judge result on same row, not multiple entries
- [x] **`tables` is wiped on every round advance** (DELETE + re-import) — not a historical log

### 10. Judge calls / judge results

- [x] No separate judge results table — lives on `tables.judgeResult`
- [x] `judgeResult` is **free-text**, not an enum — e.g. `"Player 1 1 - 2 Player 2 (0 draw)"`
- [x] Not linked to penalties by a FK — correlated only by tournamentId + tableNumber + round context
- [x] Coverage and judge result are the same row on `tables` (not separate tables)

### 11. Staff / PF users

- [x] `profiles` table accessible with anon key + valid JWT ✓ (`users` → 404)
- [x] Columns: `id` (uuid = JWT sub), `firstname`, `lastname`, `colors`
- [x] UUID → name: concatenate `firstname + ' ' + lastname`
- [x] No filter needed — returns all staff profiles

### 12. JWT behavior

- [x] JWT validity: ~**48 hours** from issue (Discord OAuth provider)
- [x] No refresh token in payload — re-login required when expired (manual re-paste)
- [ ] Does PF client auto-refresh before expiry? Not confirmed
- [ ] Gear icon warning threshold (30 min) — not tested

---

## Recording results

After the event, update these files:
1. `agent/CARDE_IO.md` — fill in confirmed field names, response shapes, remove speculation
2. `agent/PURPLEFOX.md` — fill in table names, column lists, remove "assumed" notations
3. `plans/phase-0.md` → P0.1 checklist — check off confirmed items
4. Create `memory/session_YYYY-MM-DD.md` with what was learned

---

## Notes

- Don't make exploratory calls faster than the ingestion worker would — we're a read-only consumer,
  not a scraper. One manual `curl` per endpoint per need is fine.
- If you're at the event, use `curl -s | jq` for quick inline response inspection.
- If remote, hit `/api/data/rounds` etc. on a running dev server after a sync to inspect stored shape.
- Ghost match behavior (`is_ghost_match`) is informational only — the ghost marking may occur entirely
  outside of Carde.io. Don't rely on it for any logic.
