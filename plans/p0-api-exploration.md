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

### 1. `tournament_overview` — live structure

Call: `GET /api/magic-events/{event_id}/tournament_overview/`

- [ ] Confirm it returns 200 (not 404) while event is active
- [ ] Capture the full response shape — document every top-level field
- [ ] Confirm fields present: current round number, incomplete match count, timer state
- [ ] Does it include `timer_end_datetime` (or timer epoch/ms equivalent)?
- [ ] Does it include `timer_remaining_seconds` or similar?
- [ ] Update `agent/CARDE_IO.md` → "tournament_overview structure" with real response

### 2. `get_all_rounds` — live round fields

Call: `GET /api/magic-events/{event_id}/get_all_rounds/` mid-event

- [ ] Does an active round include `timer_end_datetime` directly on the round object?
  - Current assumption: must be computed as `started_at + timer_duration_minutes*60 + extra_time_seconds`
  - If it IS present, note the exact field name and whether it accounts for round-level extra time
- [ ] Confirm which key holds round-level extra time on live responses: `extra_time_seconds` or `additional_time_seconds` (documented as inconsistent — check both)
- [ ] Confirm `carde_status` value for the currently active round (`ACTIVE` assumed)
- [ ] Confirm `pairings_status` values observed (document all seen)
- [ ] For Top-8 rounds: confirm `timer_duration_minutes` is `null`, confirm `started_at` is still set

### 3. `matches-list` — outstanding table filter

Call: `GET /api/v2/organize/tournament-rounds/{round_id}/matches-list/?status=in_progress&avoid_cache=true`

- [ ] Confirm `status=in_progress` works in PF+Carde mode (documented as confirmed — just re-verify)
- [ ] Confirm `avoid_cache=true` is accepted and doesn't 400
- [ ] Inspect a live match object — confirm field presence: `time_extension_seconds`, `result_reported_at`, `is_ghost_match`, `assigned_judge`, `player_match_relationships`
- [ ] For an in-progress match: is `result_reported_at` null (expected) or populated?
- [ ] For a draw (if one occurs): confirm `result_reported_at` is null, confirm `updated_at` is non-null
- [ ] Capture `player_match_relationships[*].user_identifier` shape — is this a UUID or a string handle?
- [ ] Confirm `table_number: -1` entries appear in `in_progress` results or are they filtered out?

### 4. Pagination

- [ ] Confirm default page size for `matches-list` (assumed 50 — check `count`, `next`, `previous`)
- [ ] Confirm `ordering=table_number` still works on live data
- [ ] Document max page size if `page_size=` param is accepted

### 5. Event completion boundary

After the event ends (Top 8 complete):
- [ ] Confirm `tournament_overview` returns 404 immediately after event completion
- [ ] Confirm `get_all_rounds` still returns 200 with all rounds for historical access
- [ ] Note any fields that change after completion (e.g., `carde_status` on rounds)

---

## PurpleFox

All PF calls go through Supabase REST: `GET {SUPABASE_URL}/rest/v1/{table}?...`
Auth: `apikey: {SUPABASE_ANON_KEY}`, `Authorization: Bearer {JWT}`

### 6. Drops table

Table: `drops` (assumed — verify actual table name)

- [ ] Confirm exact Supabase table name (case-sensitive)
- [ ] List all columns returned in a real response — record exact camelCase names
- [ ] Confirm: `tableNumber`, `round`, `isChecked`, `tournamentId` (suspected names)
- [ ] Is there a `droppedBy` or `staffName` column? (player name vs staff name)
- [ ] Is `isChecked` a boolean or 0/1 integer?
- [ ] Is there a `createdAt` / `updatedAt` timestamp? What timezone/format?
- [ ] Filter used: `tournamentId=eq.{uuid}` — confirm this works and returns only that event's drops

### 7. Extensions — `tournament_logs`

Table: `tournament_logs`

- [ ] Confirm exact Supabase table name
- [ ] List all columns — record exact camelCase names
- [ ] Confirm action/description format: `"Change time from Xmin to Ymin"` — any variation observed?
- [ ] Is there a `tableNumber` column directly, or must it be joined?
- [ ] Is there a `round` column, or is round truly absent (confirmed gap — just re-verify)?
- [ ] Is there a `staffId` or `staffName` column linking to who granted the extension?
- [ ] Confirm `createdAt` timezone: UTC or server-local? (UTC assumed from Supabase)
- [ ] Filter: `tournamentId=eq.{uuid}&action=like.Change*` or similar — what filter works?

### 8. Penalties — `tournament_penalities` (typo)

Table: `tournament_penalities` (extra 'i' — confirmed typo in real schema)

- [ ] Re-confirm the table name is exactly `tournament_penalities`
- [ ] List all columns — record exact camelCase names
- [ ] Confirm fields: `tableNumber`, `round`, `infraction`, `remedy`, `staffId`, `tournamentId`
- [ ] Is there a player name field? Or just table number?
- [ ] Is there a `notes` or `description` free-text field?
- [ ] Confirm `createdAt` format and timezone

### 9. Table coverage

Table: `table_coverage` (assumed — verify)

- [ ] Confirm exact Supabase table name
- [ ] List all columns — record exact camelCase names
- [ ] Confirm `coveredBy` is a staff name string (not a UUID)
- [ ] Is there a round number column? Or only timestamp?
- [ ] Can multiple coverage entries exist for the same table in the same round?

### 10. Judge calls / judge results

Table: unknown — need to discover

- [ ] Find the actual table name (try: `table_judge_results`, `judge_calls`, `judgeResults`, `judgeCallResults`)
- [ ] The old Python code used two separate tables for coverage and judge results — confirm they're separate in PF
- [ ] List all columns
- [ ] What values does `judgeResult` take? (e.g., `"Warning"`, `"Game Loss"`, `"No Issue"`)
- [ ] Is it linked to penalties? Or separate?

### 11. Staff / PF users

- [ ] Is there a `users` or `profiles` table accessible via the anon key?
- [ ] If yes: confirm the shape used to map `staffId` UUID → display name
- [ ] If no: PF user lookup requires a separate authenticated call — document the path

### 12. JWT behavior

- [ ] Note the `exp` timestamp on a fresh JWT — how long is the typical validity window?
- [ ] Does PurpleFox issue a refresh token or is it always a manual re-paste?
- [ ] Does the Supabase client in PF auto-refresh before expiry? (Would affect how long a session stays valid)
- [ ] At what point before expiry does the gear icon warning appear? (Currently: 30 min — confirm this is useful)

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
