# Carde.io — API Quick Reference

Confirmed 2026-05-21 via live session (event 611916) + HAR analysis.
Full behavioral notes: `agent/CARDE_IO.md`

Auth header on every request:
  Authorization: Token {CARDE_API_TOKEN}

Base URL: https://api.admin.carde.io

---

## Read patterns

### All rounds (structure + status)

    GET /api/magic-events/{event_id}/get_all_rounds/

Returns array of phase objects. Each phase has a `rounds` array.
All rounds exist from the first call — pre-created upfront.

Round fields: `id`, `round_number`, `status`, `pairings_status`, `standings_status`,
`round_type`, `started_at`, `completed_at`, `timer_duration_minutes`, `final_round_in_event`,
`use_old_pairings`, `astrolabe_url`, `needs_retroactive_standings_update`,
`has_manual_pairing_modifications`, `tournament_phase`

Status values: `UPCOMING` | `IN_PROGRESS` | `COMPLETE`

### Live event state (outstanding count, current round)

    GET /api/magic-events/{event_id}/tournament_overview/

Key fields: `current_round` (id, round_number, status, pairings_status, standings_status),
`number_of_incomplete_matches` (outstanding tables), `lifecycle_status`, `tournament_phases`

Returns 404 for completed events. Does NOT contain `timer_end_datetime`.

### Timer state

    GET /api/v2/organize/events/{event_id}/detail/

The only endpoint with `timer_end_datetime`. Key fields:

    timer_end_datetime       string|null  Static ISO UTC timestamp. Not a live countdown.
    timer_is_running         boolean      Does NOT flip false on expiry — stays true.
    timer_paused_at_datetime string|null  Set when paused, null when running.
    settings.round_duration_in_minutes  integer  Configured default round length.

Detect expiry: DateTime.now() >= DateTime.parse(timer_end_datetime)

### Matches — all for a round

    GET /api/v2/organize/tournament-rounds/{round_id}/matches-list/?page_size=200&ordering=table_number

### Matches — outstanding tables only

    GET /api/v2/organize/tournament-rounds/{round_id}/matches-list/?status=in_progress&avoid_cache=true&page_size=200

`page_size=200` returns all matches in one call (confirmed for small events; use for any
round with < 200 outstanding tables, which is every realistic mid-event snapshot).

Response: `{page_size, count, total, current_page_number, next, previous, results: [...]}`

### Match history

    GET /api/v2/organize/matches/{match_id}/history/

### Player match history at event

    GET /api/tournament-matches/get_matches_for_user_event_status/?user_id={user_id}&event_id={event_id}

### Penalty categories (always empty for our events)

    GET /api/magic-event-settings/{settings_id}/list_questions/

Returns `[]` — penalties are handled in PurpleFox, not Carde.

---

## Write patterns

### Timer control

    POST /api/magic-events/{event_id}/edit_current_round_timer/

Event-level endpoint (not round-level). Modes:

    {"mode":"resume"}                              Start/resume timer
    {"mode":"pause"}                               Pause timer
    {"mode":"reset"}                               Reset to default duration (paused)
    {"mode":"reset","minutes_to_set_directly":50}  Set to N minutes (float OK, stays paused)

Always returns: `{id, timer_is_running, timer_end_datetime, timer_paused_at_datetime}`
Note: fires twice in rapid succession from the Carde UI (double-write pattern, not a bug).

Typical round-start sequence:
1. POST {"mode":"reset","minutes_to_set_directly":50}  ← set duration while paused
2. POST {"mode":"resume"}                               ← start clock

### Per-match time extension

    PATCH /api/v2/organize/matches/{match_id}/
    {"time_extension_seconds": 120}

Value is in SECONDS. Does not affect event-level `timer_end_datetime`.
For our events this is always 0 — extensions are tracked in PurpleFox only.

### Submit result

    PATCH /api/v2/organize/matches/{match_id}/

Win:
    {"players":[{"id":{pmr_id},"games_won":2},{"id":{pmr_id},"games_won":0}],"games_drawn":0}

Intentional draw:
    {"players":[{"id":{pmr_id},"games_won":0},{"id":{pmr_id},"games_won":0}],"games_drawn":3,"match_is_intentional_draw":true}

The `id` values are player_match_relationship IDs from the match object, not player IDs.

### Round turnover (mark complete + publish)

    POST /api/magic-events/{event_id}/publish_pairings_and_turnover_round/
    {"brand_key":"riftbound"}   (or "lorcana")

Returns: `{"status":"success"}`
This is a single call that marks current round COMPLETE and advances event state.
Pairings and standings for the new round must be generated separately (below).

### Generate next round pairings

    POST /api/magic-events/{event_id}/pair_next_round/
    {"add_padded_byes":false}

Returns: `{"status":"success"}`

### Generate standings

    POST /api/magic-events/{event_id}/generate_standings/

Returns: `{"status":"success"}`

---

## Match object — full field list

From `matches-list` results (confirmed):

    id                          integer
    table_number                integer   -1 for byes/unassigned
    pod_number                  null
    order                       integer   display order in round
    status                      string    'IN_PROGRESS' | 'COMPLETE'
    is_ghost_match              boolean
    is_feature_match            boolean
    match_is_bye                boolean
    match_is_loss               boolean
    deck_check_started          boolean
    deck_check_completed        boolean
    time_extension_seconds      integer   always 0 for our events
    winning_player_id           integer|null
    match_is_intentional_draw   boolean
    match_is_unintentional_draw boolean
    games_drawn                 integer|null   null while in progress
    games_won_by_winner         integer|null
    games_won_by_loser          integer|null
    result_reported_at          string|null    null while pending; always null for draws
    assigned_judge              null           always null in observed data
    reporting_player            null|object
    last_modified_by_name       null|string
    created_at                  string    ISO UTC
    updated_at                  string    ISO UTC
    player_match_relationships  array     see below

### player_match_relationships entry

    id                  integer   player_match_relationship ID (used in result submission)
    match_id            integer
    player_order        integer   1 or 2
    games_won           integer
    is_starting_player  boolean
    pod_seat_number     integer
    user_event_status:
      id                      integer
      user_identifier         string    display name e.g. "Aldo M" (first + last initial)
      special_user_identifier null
      matches_won             integer
      matches_lost            integer
      matches_drawn           integer
      total_match_points      integer
      registration_status     string    "COMPLETE"
      queue_check_in_status   null
      player_interactions     array
      deck_submission         null
      user:
        id              integer   stable player ID
        email           string
        last_name       string
        last_first      string    "Lastname, Firstname"
        first_last      string    "Firstname Lastname"
        best_identifier string    same as user_identifier
        initials        string
        pronouns        null
        country_code    null
        game_user       null | {display_name: string}
    player:
      id              integer
      email           string
      first_name      string
      last_name       string
      best_identifier string
      user            null

user_identifier is a display name string ("Aldo M"), NOT a UUID or numeric gameId.
Use user.id (integer) or user.email as stable player identifiers.

---

## Round object — field diff by status

    Field                    UPCOMING        IN_PROGRESS         COMPLETE
    started_at               null            "2026-05-21T..."    "2026-05-21T..."
    completed_at             null            null                "2026-05-21T..."
    timer_duration_minutes   null            null*               integer
    status                   "UPCOMING"      "IN_PROGRESS"       "COMPLETE"
    pairings_status          "NOT_GENERATED" "GENERATED"         "GENERATED"
    standings_status         "NOT_GENERATED" "NOT_GENERATED"     "GENERATED"

*timer_duration_minutes on an IN_PROGRESS round is null until edit_current_round_timer
is called. It becomes non-null once the timer is set for that round.

completed_at on round N == started_at on round N+1 (exact same timestamp, atomic).

---

## Gotchas

| Issue | Detail |
|---|---|
| `timer_is_running` never auto-flips | Stays true after expiry. Compare timer_end_datetime to wall time instead. |
| `timer_end_datetime` not on round objects | Only on `v2/organize/events/{id}/detail/` and edit_current_round_timer responses. |
| `timer_end_datetime` has server lag | Offset from started_at + duration by +7 to +83 seconds. |
| `extra_time_seconds` doesn't exist | No such field on round objects. Per-match extension is `time_extension_seconds` on match objects (seconds). |
| `timer_end_datetime` ignores per-match extensions | Event timer reflects round-level clock only. Table-level extensions in PF are separate. |
| Double-fire on edit_current_round_timer | UI always sends the call twice. Ingestion worker sees both; treat them as one. |
| `result_reported_at` null for draws | Use `updated_at` as proxy for when draw result was entered. |
| `completed_at` != round end time | Equals next round's started_at. Cannot derive break duration from it. |
| `timer_duration_minutes` null on active rounds | Until timer is explicitly set via edit_current_round_timer. |
| Default page size is 25 | Always use page_size=200 for outstanding table queries to avoid pagination. |
