# Carde.io

Carde.io is the tournament management software used for Riftbound and Lorcana events. It
handles pairings, match results, standings, and the round clock. This tool reads from it
via a static admin API token.

Base URL: `https://api.admin.carde.io`
Auth: `Authorization: Token {CARDE_API_TOKEN}`

Confirmed via live session 2026-05-21 (event 611916, 3-round Swiss) + HAR analysis.
Full implementation reference: `docs/carde-api.md`

---

## Core endpoints

### Round structure — `get_all_rounds`

`GET /api/magic-events/{event_id}/get_all_rounds/`

Returns an array of phase objects, each with a `rounds` array. All rounds are pre-created
upfront — every round exists from the first call before any round starts.

Round object fields:

```json
{
  "id":                              "integer — round ID (use for matches-list calls)",
  "round_number":                    "integer",
  "status":                          "string — 'UPCOMING' | 'IN_PROGRESS' | 'COMPLETE'",
  "pairings_status":                 "string — 'NOT_GENERATED' | 'GENERATED'",
  "standings_status":                "string — 'NOT_GENERATED' | 'GENERATED'",
  "round_type":                      "string — e.g. 'PLAY_VS_OPPONENT'",
  "started_at":                      "string|null — ISO with -0600 offset e.g. '2026-05-21T01:20-0600'",
  "completed_at":                    "string|null — set at turnover; null while IN_PROGRESS",
  "timer_duration_minutes":          "integer|null — null until edit_current_round_timer sets it",
  "final_round_in_event":            "boolean",
  "use_old_pairings":                "boolean",
  "astrolabe_url":                   "null",
  "needs_retroactive_standings_update": "boolean",
  "has_manual_pairing_modifications": "boolean",
  "tournament_phase":                "integer — phase ID"
}
```

**`timer_duration_minutes` behavior**: null on a round until `edit_current_round_timer`
is called with `minutes_to_set_directly`. Once set, it reflects that value. For COMPLETE
rounds it retains the value from when it was set. **There is no `extra_time_seconds` or
`additional_time_seconds` on round objects — these fields do not exist.**

**`completed_at` behavior**: Set atomically at round turnover. For Swiss rounds,
`completed_at` on round N equals `started_at` on round N+1 (same instant — single button
click in the UI). `completed_at` is null while the round is IN_PROGRESS.

**Round status values confirmed**: `UPCOMING`, `IN_PROGRESS`, `COMPLETE`. No other values
observed. Rounds not yet started are `UPCOMING`.

### Live event state — `tournament_overview`

`GET /api/magic-events/{event_id}/tournament_overview/`

Returns a live snapshot of the event. Does NOT contain `timer_end_datetime` — timer state
lives on `v2/organize/events/{event_id}/detail/` instead. Does return round objects with
the same fields as `get_all_rounds`, nested inside `tournament_phases[].rounds[]`.

Top-level fields:

```json
{
  "id":                      "integer — event ID",
  "name":                    "string",
  "lifecycle_status":        "string — e.g. 'EVENT_IN_PROGRESS'",
  "number_of_incomplete_matches": "integer — outstanding tables for current round",
  "current_round": {
    "id":                    "integer",
    "round_number":          "integer",
    "status":                "string",
    "pairings_status":       "string",
    "standings_status":      "string"
  },
  "tournament_phases":       "array of phase objects each containing rounds[]"
}
```

`number_of_incomplete_matches` is the live outstanding table count. Returns 404 for
completed events.

### Timer state — `v2/organize/events/{event_id}/detail/`

`GET /api/v2/organize/events/{event_id}/detail/`

This is where `timer_end_datetime` lives. Also contains full settings and phases.

Timer-relevant fields:

```json
{
  "timer_end_datetime":      "string|null — ISO UTC e.g. '2026-05-21T07:29:21Z'",
  "timer_is_running":        "boolean — does NOT flip to false on timer expiry",
  "timer_paused_at_datetime":"string|null — set when paused, null when running"
}
```

**`timer_is_running` does not auto-flip to false when the clock expires.** It stays true
until the timer is manually paused or the round is completed. The only reliable way to
detect expiry is to compare `timer_end_datetime` against the current wall time.

**`timer_end_datetime` is a static ISO timestamp** — it does not decrement. It is set
when `edit_current_round_timer` is called with `mode: "resume"`. It reflects the round
clock end time including any `minutes_to_set_directly` override but does NOT account for
per-match `time_extension_seconds`.

**Server lag**: `timer_end_datetime` is offset from
`started_at + timer_duration_minutes * 60` by +7 to +83 seconds of server-side
processing. Do not assume they are exactly equal.

### Match pairings — `matches-list`

`GET /api/v2/organize/tournament-rounds/{round_id}/matches-list/`

Paginated. Default page size: 25. `page_size=200` works and returns all matches in one
call. Response shape:

```json
{
  "page_size":           "integer",
  "count":               "integer — matches on this page",
  "total":               "integer — total matches in round",
  "current_page_number": "integer",
  "next":                "string|null",
  "previous":            "string|null",
  "next_page_number":    "integer|null",
  "previous_page_number":"integer|null",
  "results":             "array of match objects"
}
```

Confirmed working query params:
- `status=in_progress` — returns only pending matches (no result yet)
- `avoid_cache=true` — accepted, no errors
- `ordering=table_number` — ascending by table number
- `page_size=200` — returns all matches in one call

Match object fields (all confirmed):

```json
{
  "id":                      "integer",
  "table_number":            "integer — -1 for byes",
  "pod_number":              "null",
  "order":                   "integer — display order in round",
  "status":                  "string — 'IN_PROGRESS' | 'COMPLETE'",
  "is_ghost_match":          "boolean",
  "is_feature_match":        "boolean",
  "match_is_bye":            "boolean",
  "match_is_loss":           "boolean",
  "deck_check_started":      "boolean",
  "deck_check_completed":    "boolean",
  "time_extension_seconds":  "integer — per-match extension in SECONDS (not minutes)",
  "winning_player_id":       "integer|null",
  "match_is_intentional_draw":   "boolean",
  "match_is_unintentional_draw": "boolean",
  "games_drawn":             "integer|null — null while in progress",
  "games_won_by_winner":     "integer|null",
  "games_won_by_loser":      "integer|null",
  "result_reported_at":      "string|null — null while pending; null for draws (use updated_at instead)",
  "assigned_judge":          "null (always null in observed data)",
  "reporting_player":        "null|object",
  "last_modified_by_name":   "null|string",
  "created_at":              "string — ISO UTC",
  "updated_at":              "string — ISO UTC",
  "player_match_relationships": "array — see below"
}
```

`player_match_relationships` sub-object:

```json
{
  "id":             "integer — player_match_relationship ID",
  "match_id":       "integer",
  "player_order":   "integer — seat number (1 or 2)",
  "games_won":      "integer",
  "is_starting_player": "boolean",
  "pod_seat_number": "integer",
  "user_event_status": {
    "id":                  "integer",
    "user_identifier":     "string — display name e.g. 'Aldo M' (first + last initial)",
    "special_user_identifier": "null",
    "matches_won":         "integer",
    "matches_lost":        "integer",
    "matches_drawn":       "integer",
    "total_match_points":  "integer",
    "registration_status": "string — 'COMPLETE'",
    "queue_check_in_status": "null",
    "player_interactions": "array",
    "deck_submission":     "null",
    "user": {
      "id":            "integer",
      "email":         "string",
      "last_name":     "string",
      "last_first":    "string — 'Lastname, Firstname'",
      "first_last":    "string — 'Firstname Lastname'",
      "best_identifier": "string — same as user_identifier",
      "initials":      "string",
      "pronouns":      "null",
      "country_code":  "null",
      "game_user":     "null | {display_name: string}"
    }
  },
  "player": {
    "id":            "integer",
    "email":         "string",
    "first_name":    "string",
    "last_name":     "string",
    "best_identifier": "string",
    "user":          "null"
  }
}
```

**`user_identifier` is a display name string** (`"Aldo M"` format), not a UUID or gameId.
Use `user.id` (integer) or `user.email` as the stable player identifier.

---

## Write operations

### Timer control — `edit_current_round_timer`

`POST /api/magic-events/{event_id}/edit_current_round_timer/`

**Event-level endpoint** (not round-level). Accepts a `mode` field:

| Body | Effect |
|---|---|
| `{"mode":"resume"}` | Start/resume timer. Sets `timer_is_running: true`. |
| `{"mode":"pause"}` | Pause timer. Sets `timer_paused_at_datetime`. |
| `{"mode":"reset"}` | Reset to default duration while paused. |
| `{"mode":"reset","minutes_to_set_directly":N}` | Reset and set to N minutes (float accepted). |

Response always returns:
```json
{
  "id":                    "integer — event ID",
  "timer_is_running":      "boolean",
  "timer_end_datetime":    "string — ISO with -06:00 offset",
  "timer_paused_at_datetime": "string|null"
}
```

This endpoint fires **twice in rapid succession** when triggered from the Carde UI (double-
write pattern). Both calls are identical. This is UI behavior, not a bug.

### Per-match time extension

`PATCH /api/v2/organize/matches/{match_id}/`
Body: `{"time_extension_seconds": N}` (integer seconds)

This is a separate field on the match object. It does NOT affect `timer_end_datetime` on
the event — the event timer only reflects the round-level clock. A "+0 min" badge appeared
in the UI for a 2-second extension, confirming the field is in seconds.

### Result submission

`PATCH /api/v2/organize/matches/{match_id}/`

Win: `{"players":[{"id":{pmr_id},"games_won":2},{"id":{pmr_id},"games_won":0}],"games_drawn":0}`
Draw: `{"players":[{"id":{pmr_id},"games_won":0},{"id":{pmr_id},"games_won":0}],"games_drawn":3,"match_is_intentional_draw":true}`

The `id` values in the `players` array are `player_match_relationship` IDs, not player IDs.

### Round turnover

`POST /api/magic-events/{event_id}/publish_pairings_and_turnover_round/`
Body: `{"brand_key":"riftbound"}` (or `"lorcana"`)

Single call that marks the current round COMPLETE, publishes standings, and advances the
event. Returns `{"status":"success"}`.

Pairings for the next round must be generated separately:
`POST /api/magic-events/{event_id}/pair_next_round/`
Body: `{"add_padded_byes":false}`

Standings must be generated separately:
`POST /api/magic-events/{event_id}/generate_standings/`
Returns `{"status":"success"}`.

---

## Integration patterns

### How to get timer expiry

Timer expiry is not directly signaled — poll `v2/organize/events/{event_id}/detail/` and
compare `timer_end_datetime` (static UTC timestamp) against current wall time:

```
expired = DateTime.now() >= DateTime.parse(timer_end_datetime)
```

Do not rely on `timer_is_running` — it stays true after expiry. Do not rely on
`timer_duration_minutes` on round objects — it is null until the timer is explicitly set
and does not update in real time.

### How to get outstanding tables

`GET /api/v2/organize/tournament-rounds/{round_id}/matches-list/?status=in_progress&avoid_cache=true&page_size=200`

Returns all matches with no result yet. At timer expiry, this response directly produces
`missing_tables_json`. Use `page_size=200` to avoid pagination.

### Round ID convention

The `TOURNAMENTS` config stores a `carde_base_round_id`. Actual round IDs come from
`get_all_rounds` — use the `id` field directly. Do not compute round IDs arithmetically
from a base; the base+offset pattern was an old heuristic and should not be relied on.

### Background worker — why it exists

Fetching match pairings is slow: each round may have hundreds of matches. Doing this
synchronously would time out the HTTP response. The worker fetches paginated matches,
upserts into the local DB, and updates `rounds_fetched`. A lock prevents two concurrent
workers for the same tournament.

**Implication**: after a sync, pairings data may not yet be available if the worker is
still running.

### What triggers a round pairings re-fetch

Re-fetches if any of:
- Round not yet in `rounds_fetched` (new round)
- Round's `carde_status` changed since last fetch (e.g. IN_PROGRESS → COMPLETE)
- Round flagged as a snapshot round (needs `missing_tables_json` captured)

Does NOT re-fetch if already COMPLETE and status unchanged.

### Snapshot rounds and `missing_tables_json`

At timer expiry, the tool captures which tables are outstanding as a JSON array (e.g.
`[4, 23, 51]`). Written once, protected by COALESCE upsert semantics — a later sync
with fewer outstanding tables will not overwrite an earlier more-complete snapshot.

---

## Gaps and confirmed non-issues

### `timer_end_datetime` absent from `get_all_rounds`

Confirmed: `timer_end_datetime` is not a field on round objects in `get_all_rounds` or
`tournament_overview`. It lives only on `v2/organize/events/{id}/detail/` and is returned
by `edit_current_round_timer` responses. Must call `detail/` separately to get timer state.

### `extra_time_seconds` / `additional_time_seconds` — do not exist on round objects

Confirmed absent. Per-match extensions are on match objects as `time_extension_seconds`
(seconds). Round-level timer adjustments are made via `edit_current_round_timer` and
reflected only in `timer_end_datetime`, not in any round object field.

### `completed_at` is NOT "when the round ended"

For Swiss rounds, `completed_at` on round N equals `started_at` on round N+1 — same
instant, single button click. Cannot be used to compute break duration or turnover time.
Only diverges at phase transitions and overnight gaps.

### `result_reported_at` is null for draws

Drawn matches always have `result_reported_at: null`. Use `updated_at` as proxy.

### `time_extension_seconds` is always 0 for our events

Per-match extensions are tracked in PurpleFox. The `time_extension_seconds` field on
Carde match objects will always be 0 for events using our workflow — judges do not enter
extensions into Carde, they enter them into PF. (The 2-second value in the test HAR was
set manually for exploration purposes only.)

### `list_questions` returns empty for our events

`GET /api/magic-event-settings/{settings_id}/list_questions/` returns `[]` — no
configured penalty categories. Penalties are handled entirely in PurpleFox.

### UI polling behavior

The Carde admin UI polls `tournament_overview`, `get_all_rounds`, and `detail/` on a
slow interval (these endpoints appeared only 3 times each across the full session). The
UI is not aggressively polling — our ingestion worker interval does not need to be
conservative to avoid conflicting with UI requests.
