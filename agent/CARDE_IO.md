# Carde.io

Carde.io is the tournament management software used for Riftbound and Lorcana events. It handles pairings, match results, standings, and the round clock. This tool reads from it via a static admin API token.

Base URL: `https://api.admin.carde.io`  
Auth: `Authorization: Token {CARDE_API_TOKEN}`

## Uses

### Round structure and timing

`GET /api/magic-events/{event_id}/get_all_rounds/` returns all phases and rounds with:

- `id` — round ID (used for pairings calls)
- `round_number`
- `started_at` — when the TO started the round clock (EDT for US events)
- `completed_at` — when the round was marked COMPLETE
- `timer_duration_minutes` — base round length (60 for Riftbound, 50 for Lorcana; NULL for Top 8)
- `extra_time_seconds` / `additional_time_seconds` — round-level extra time added by the TO
- `carde_status` — UPCOMING / SCHEDULED / ACTIVE / COMPLETE
- `pairings_status` — PUBLISHED / etc.

### Match pairings and results

`GET /api/v2/organize/tournament-rounds/{round_id}/matches-list/` returns paginated matches per round. Key fields per match:

- `id` — match ID
- `table_number` — -1 for byes/unassigned
- `pod_number` — nullable
- `order` — display order within the round
- `status` — `IN_PROGRESS`, `COMPLETE`, etc.
- `match_is_bye` — true for auto-win matches
- `match_is_loss` — true for judge-assigned given losses
- `match_is_intentional_draw` / `match_is_unintentional_draw`
- `is_ghost_match` — match is no longer physically active (players left, result not entered)
- `is_feature_match`
- `deck_check_started` / `deck_check_completed`
- `time_extension_seconds` — always 0 for our events (extensions tracked in PurpleFox)
- `winning_player_id`
- `games_won_by_winner` / `games_won_by_loser` / `games_drawn`
- `result_reported_at` — when result was entered; null for draws — use `updated_at` instead
- `created_at` / `updated_at` — ISO 8601 with UTC offset (`+00:00`)
- `assigned_judge` — nullable; judge assigned to this match
- `reporting_player` — nullable
- `last_modified_by_name` — nullable
- `player_match_relationships` — array of player objects with `user_identifier` and `user.id`

### Live tournament state (active events only)

`GET /api/magic-events/{event_id}/tournament_overview/` provides a live snapshot including timer state, incomplete match count, and current round. **Returns 404 for completed events.**

---

## Integration patterns

### Round ID convention

The `TOURNAMENTS` dict in `serve.py` stores a `carde_base_round_id` for each tournament. The actual first round's ID is `base_round_id + 1`. Subsequent rounds increment from there. This is because Carde.io allocates IDs starting one above the phase/container ID.

```python
# Example: carde_base_round_id = 721201
# Round 1 = 721202, Round 2 = 721203, ... Round 8 = 721209
```

When calling `matches-list` for a round, use the round's actual `id` from the `get_all_rounds` response — do not try to compute it from the base.

### Background worker — why it exists

Fetching match pairings is slow: each round may have hundreds of matches spread across many pages. Doing this synchronously during a sync request would time out the HTTP response. Instead:

- `fetch_and_store()` determines which rounds need pairings fetches
- It starts `_carde_worker()` in a daemon thread and returns immediately
- The worker fetches paginated matches, upserts into `round_pairings`, and updates `rounds_fetched`
- `_carde_lock` + `_carde_running` prevent two concurrent workers for the same tournament

**Implication for agents**: after a sync, `round_pairings` data may not yet be available if the worker is still running. Do not assume pairings are populated immediately after a sync response.

### What triggers a round pairings re-fetch

The decision logic in `fetch_and_store()` re-fetches a round's pairings if any of these are true:

- The round is not in `rounds_fetched` at all (new round)
- The round's `carde_status` has changed since last fetch (e.g., ACTIVE → COMPLETE)
- The round is flagged as a "snapshot round" (needs `missing_tables_json` captured)

It does **not** re-fetch if the round is already COMPLETE in `rounds_fetched` and status hasn't changed — this prevents redundant API calls on every sync.

### Snapshot rounds and `missing_tables_json`

When a round clock expires and there are still missing results, the tool tries to capture which tables are outstanding in `missing_tables_json`. This snapshot is only accurate if the sync happens close to the timer expiry.

- The snapshot is a JSON array of table numbers: e.g. `[4, 23, 51, 56, 64, 89]`
- It is written once and protected by `COALESCE` upsert semantics — a later sync with fewer missing tables will not overwrite a more complete earlier snapshot
- For rounds where the snapshot was captured late (after most results came in), the data is unreliable and should be flagged
- Rounds without any snapshot (`missing_tables_json IS NULL`) simply have no outstanding-table data available

### Field naming inconsistency: `extra_time_seconds` vs `additional_time_seconds`

Carde.io's API returns round-level extra time under the key `additional_time_seconds` in some responses and `extra_time_seconds` in others. The local DB column is `extra_time_seconds`. When parsing the API response, check for both keys.

### Top-8 rounds have NULL timing fields

Playoff bracket rounds (`timer_duration_minutes IS NULL`) cascade to `timer_end_datetime = NULL`. Do not attempt to compute timing metrics for these rounds — any arithmetic involving `timer_end_datetime` will fail or produce nonsense. Always guard with a null check before computing scheduled end, break duration, or turnover for a round.

---

## Gaps

### `timer_end_datetime` is absent from completed event responses

The API documentation lists `timer_end_datetime` as a round field, but it does not appear in actual responses for completed events. It must be computed locally:
```
timer_end_datetime = started_at + (timer_duration_minutes * 60) + extra_time_seconds
```
It may be present for live events — not yet confirmed.

### `completed_at` is NOT "when the round ended"

For Swiss rounds, `completed_at` on round N and `started_at` on round N+1 are set at the **same instant** — a single button click in the Carde.io UI ("Complete & Pair Next Round"). They are always equal for back-to-back Swiss rounds. This means:

- `completed_at` cannot be used to compute break duration or total round duration
- It only diverges in boundary cases: the overnight gap (e.g., R8 → Day 2) and phase transitions (e.g., R13 → Top 8)

### No pairings timestamp

There is no `pairings_published_at`, `pairings_generated_at`, or similar field. The only indicator is `pairings_status` (a string). We use `started_at` (when the TO starts the clock) as a proxy for pairings being published, which is reasonable since TOs typically start the timer immediately after publishing.

### `result_reported_at` is null for draws

Drawn matches always have `result_reported_at: null`. Use `updated_at` as a proxy for when the result was entered.

### `tournament_overview` 404s for completed events

All live-state endpoints (timer, audit, history, overview) return 404 after an event is marked complete. There is no retroactive access to historical timer state.

### Matches-list filters

The older `GET /api/v2/organize/matches/?event_id=...` endpoint silently ignores all filter params.
The correct endpoint is `tournament-rounds/{round_id}/matches-list/`. Confirmed working params:

- `ordering=table_number` and `ordering=-table_number` (ascending/descending)
- `judge=assigned_to_me` (filters by assigned judge)
- `search=<name>` (player name search, returns 0 results for non-players)
- `status=in_progress` — **returns only matches that have not yet reported a result**. This is the key filter for outstanding table tracking. Use `avoid_cache=true` alongside it.

Params confirmed non-functional (silently return full count): `has_time_extension`, `result`, `result_pending`.

**Note on `status=in_progress` and the UI:** The "Match Status → In Progress" toggle in the Carde admin UI is purely client-side. It does not change the API call. The backend polling cycle always sends `status=in_progress` regardless of the UI toggle state. This is the correct filter to use in the ingestion worker.

**Ingestion implication:** We never need to fetch all matches for a round. The outstanding table list is exactly the response from `status=in_progress`. At timer expiry, this response directly produces `missing_tables_json` — no in-memory filtering of a full list required.

### Match counts decrease across rounds — this is expected

R1 has the most matches (byes for no-shows inflate it). Counts decrease as players drop. Each round endpoint returns only that round's matches. The `table_number: -1` entries are byes or unassigned matches.

### Time extensions are not in Carde.io (for our events)

Extensions are granted and logged in PurpleFox. The `time_extension_seconds` field on Carde match objects will always be 0 for events using our setup. See `PURPLEFOX.md`.

### StageTimer coverage is partial (when used)

StageTimer is an optional broadcast timer — not all events use it. When it is used, it only covers the tables it was deployed for. At Atlanta RQ, this was tables 1–451 out of ~2974 total; the rest of the venue self-reported results directly into Carde.io without a managed clock. As a result, `missing_tables_json` and StageTimer-derived timing data only reflect the portion of the event that had a broadcast timer. This is not a Carde.io limitation — it's a deployment scope decision.
