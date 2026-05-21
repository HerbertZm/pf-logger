# pf-logger — Database Schema Design

_Working document for Phase 0. Reflects confirmed design decisions. Sections marked **[TBD: P0.1]** depend on API exploration results before they can be finalized._

Last updated: 2026-05-21

---

## Design principles

- **Three-layer model:** raw → normalized → app. Each layer has a single owner and a single direction of data flow.
- **Raw is append-only.** Never mutate a raw record after insert. It is the audit trail and the re-processing source.
- **Normalized is what the app queries.** Derived from raw by the ingestion worker. Business logic lives here.
- **App layer has no source dependency.** `app_*` tables are owned entirely by this tool.
- **TIMESTAMPTZ everywhere.** Every timestamp column on every table. No TEXT timestamps, no silent UTC assumptions. Carde timestamps (EDT for US events) are converted to UTC at ingestion.
- **Selective match storage.** Player-identifying match records are only stored for tables with tracked events (drops, extensions, penalties, coverage). Full match lists are fetched into memory to compute `missing_tables_json`, then discarded. See [TBD: P0.1] below.
- **`timer_end_datetime` is always computed locally:** `started_at + (timer_duration_minutes * 60)`. The Carde API does expose it on `v2/organize/events/{id}/detail/`, but compute locally for reliability — the API value has +7–83s server lag and is absent from round objects entirely. There is no round-level `extra_time_seconds` field in Carde; round timer adjustments are reflected only in the event-level `timer_end_datetime`, not in any round object field.
- **`completed_at` is stored verbatim but never used in any computation.** For Swiss rounds it equals the next round's `started_at` (same button click in Carde). Stored for raw fidelity only.
- **PF staff ≠ players ≠ app users.** Three distinct identity concepts. See identity section below.
- **SQLite DB kept as legacy archive.** No migration to new schema. Kept at `data/legacy.db` for verification during transition.

---

## Identity model

Three distinct user/person concepts that must never be conflated:

| Concept | Table | Description |
|---|---|---|
| PF staff | `pf_staff` | Judges and scorekeepers logged into PurpleFox. Source of extensions, coverage, penalties authorship. |
| Players | Denormalized in `matches` | Tournament participants. Names and IDs come from Carde match records. No dedicated table. |
| App users | `app_users` | Accounts for this tool (login, roles). Completely independent of PF or Carde identities. |

---

## Raw layer

Append-only. One table per source entity. Never joined across sources.

All raw tables include:
- `id SERIAL PRIMARY KEY`
- `fetched_at TIMESTAMPTZ NOT NULL`
- `tournament_id INT NOT NULL` — FK to `app_tournaments`
- `raw_payload JSONB` — full API response object for this record

---

### `raw_carde_rounds`

Source: `GET /api/magic-events/{event_id}/get_all_rounds/`

```sql
id                    SERIAL PRIMARY KEY
fetched_at            TIMESTAMPTZ NOT NULL
tournament_id         INT NOT NULL REFERENCES app_tournaments(id)
carde_tournament_id   INT NOT NULL
carde_round_id        INT NOT NULL
round_number          INT NOT NULL
started_at            TIMESTAMPTZ
completed_at          TIMESTAMPTZ   -- stored verbatim; equals next round's started_at for Swiss
timer_duration_min    INT           -- NULL until edit_current_round_timer sets it; NULL for Top-8
  -- NOTE: No extra_time_seconds or additional_time_seconds on round objects — these fields
  -- do not exist in the Carde API. Round-level timer adjustments are reflected only in
  -- the event-level timer_end_datetime on v2/organize/events/{id}/detail/.
carde_status          TEXT          -- UPCOMING | IN_PROGRESS | COMPLETE (no ACTIVE, no SCHEDULED)
pairings_status       TEXT          -- NOT_GENERATED | GENERATED
standings_status      TEXT          -- NOT_GENERATED | GENERATED
raw_payload           JSONB
```

---

### `raw_carde_matches`

Source: `GET /api/v2/organize/tournament-rounds/{round_id}/matches-list/?status=in_progress&avoid_cache=true`

**Ingestion strategy (resolved):** The `status=in_progress` filter is confirmed functional. The worker fetches only in-progress (outstanding) matches per round — never the full match list. At timer expiry, this response directly produces `rounds.missing_tables_json`. Player-identifying data is therefore only ever stored for tables that are actively outstanding at the time of a fetch.

```sql
id                          SERIAL PRIMARY KEY
fetched_at                  TIMESTAMPTZ NOT NULL
tournament_id               INT NOT NULL REFERENCES app_tournaments(id)
carde_round_id              INT NOT NULL
round_number                INT NOT NULL
table_number                INT NOT NULL
carde_match_id              INT NOT NULL
status                      TEXT NOT NULL       -- 'IN_PROGRESS' (only value stored here)
time_extension_sec          INT NOT NULL DEFAULT 0
  -- Always 0 when PurpleFox is the extension source.
  -- Populated from Carde in Carde-only mode.
is_ghost_match              BOOLEAN NOT NULL DEFAULT FALSE
is_bye                      BOOLEAN NOT NULL DEFAULT FALSE
match_is_loss               BOOLEAN NOT NULL DEFAULT FALSE
match_is_intentional_draw   BOOLEAN NOT NULL DEFAULT FALSE
match_is_unintentional_draw BOOLEAN NOT NULL DEFAULT FALSE
deck_check_started          BOOLEAN NOT NULL DEFAULT FALSE
deck_check_completed        BOOLEAN NOT NULL DEFAULT FALSE
assigned_judge              TEXT
result_reported_at          TIMESTAMPTZ   -- NULL for in-progress; kept for completeness
updated_at                  TIMESTAMPTZ NOT NULL
p1_user_id                  TEXT
p1_name                     TEXT
p2_user_id                  TEXT          -- NULL for byes
p2_name                     TEXT          -- NULL for byes
winning_player_id           TEXT
raw_payload                 JSONB
```

---

### `raw_pf_drops`

Source: PurpleFox `tournament_drops` table via Supabase REST.
Note: PF table name is `tournament_drops` — `drops` returns 404.
No timestamp column on PF side — cannot sort by insertion time.

```sql
id                SERIAL PRIMARY KEY
fetched_at        TIMESTAMPTZ NOT NULL
tournament_id     INT NOT NULL REFERENCES app_tournaments(id)
pf_tournament_id  TEXT NOT NULL   -- PF UUID
player_game_id    TEXT NOT NULL   -- Carde gameId string
round             INT NOT NULL
table_number      INT NOT NULL
player_name       TEXT            -- "Lastname, Firstname" (denormalized)
is_checked        BOOLEAN NOT NULL DEFAULT FALSE
is_cancelled      BOOLEAN NOT NULL DEFAULT FALSE
updated_by        TEXT            -- PF staff UUID (last actor; no separate added_by)
updated_by_name   TEXT            -- PF staff display name (denormalized)
raw_payload       JSONB
```

---

### `raw_pf_penalties`

Source: PurpleFox `tournament_penalities` table (extra 'i' is real — correct spelling returns 404).
No `tableNumber` column on PF side — penalties are not linked to a table directly.
`created_at` has no timezone suffix in PF response — treat as UTC.

```sql
id                SERIAL PRIMARY KEY
fetched_at        TIMESTAMPTZ NOT NULL
tournament_id     INT NOT NULL REFERENCES app_tournaments(id)
pf_tournament_id  TEXT NOT NULL
pf_id             TEXT NOT NULL    -- PF UUID for this record
round             INT NOT NULL
player_game_id    TEXT
player_name       TEXT             -- "Lastname, Firstname" (denormalized)
description       TEXT             -- free-text notes field
infraction_type   TEXT             -- maps to PF "type" column (e.g. "Gameplay Infractions - HIDDEN CARD ERROR")
sanction          TEXT             -- maps to PF "sanction" column (e.g. "Warning", "Intellect Penalty (IP2)")
created_at        TIMESTAMPTZ      -- parse without tz suffix; treat as UTC
creator_id        TEXT             -- PF staff UUID
creator_name      TEXT             -- PF staff display name (denormalized)
raw_payload       JSONB
```

---

### `raw_pf_extensions`

Source: PurpleFox `tournament_logs` table. Contains only time-extension entries (not a general log).
Has a direct `round` column — no need to infer round from timestamps.
`created_at` has `+00:00` suffix (UTC confirmed).

```sql
id                SERIAL PRIMARY KEY
fetched_at        TIMESTAMPTZ NOT NULL
tournament_id     INT NOT NULL REFERENCES app_tournaments(id)
pf_tournament_id  TEXT NOT NULL
pf_id             INT NOT NULL     -- PF auto-increment integer ID
table_number      INT NOT NULL
round             INT NOT NULL     -- direct column; no timestamp inference needed
action            TEXT NOT NULL    -- "Change time from Xmin to Ymin"
from_minutes      INT              -- parsed from action text
to_minutes        INT              -- parsed from action text
user_id           TEXT             -- PF staff UUID (FK to profiles.id)
created_at        TIMESTAMPTZ NOT NULL  -- includes +00:00 suffix
raw_payload       JSONB
```

---

### `raw_pf_coverage`

Source: PurpleFox `tables.coveredBy` column. Coverage (judge visited) and judge calls (judge_result)
are both on the same PF `tables` row — NOT separate tables. `table_coverage` and `table_judge_results`
do not exist in PF.

IMPORTANT: The PF `tables` table is **current-round-only** — wiped on every round advance.
Fetch this table every sync and treat each fetch as the current round's state.
No round column on coverage — round must be inferred from `tournament.round` at fetch time.

```sql
id                SERIAL PRIMARY KEY
fetched_at        TIMESTAMPTZ NOT NULL
tournament_id     INT NOT NULL REFERENCES app_tournaments(id)
pf_tournament_id  TEXT NOT NULL
table_number      INT NOT NULL
round             INT NOT NULL     -- inferred from tournaments.round at fetch time
covered_by        TEXT             -- judge display name string (NOT a UUID); null if not yet covered
raw_payload       JSONB
```

---

### `raw_pf_judge_calls`

Source: PurpleFox `tables.judgeResult` column — same row as coverage (see above).
`judge_result` is **free-text** (e.g. "Player 1 1 - 2 Player 2 (0 draw)") — not an enum.
Not linked to penalties by any FK — correlated only by table_number + round context.

```sql
id                SERIAL PRIMARY KEY
fetched_at        TIMESTAMPTZ NOT NULL
tournament_id     INT NOT NULL REFERENCES app_tournaments(id)
pf_tournament_id  TEXT NOT NULL
table_number      INT NOT NULL
round             INT NOT NULL     -- inferred from tournaments.round at fetch time
judge_result      TEXT NOT NULL    -- free-text result description
raw_payload       JSONB
```

---

### `raw_pf_staff`

Source: PurpleFox staff/users table. These are judges and scorekeepers — not players.

```sql
id            SERIAL PRIMARY KEY
fetched_at    TIMESTAMPTZ NOT NULL
pf_user_id    TEXT NOT NULL
display_name  TEXT NOT NULL
raw_payload   JSONB
```

---

## Normalized layer

Derived from raw by the ingestion worker. What the HTTP API and UI query.

---

### `rounds`

```sql
id                    SERIAL PRIMARY KEY
tournament_id         INT NOT NULL REFERENCES app_tournaments(id)
round_number          INT NOT NULL
phase                 TEXT NOT NULL     -- 'swiss' | 'top8'
carde_round_id        INT NOT NULL
carde_status          TEXT              -- UPCOMING | IN_PROGRESS | COMPLETE
started_at            TIMESTAMPTZ       -- when TO started clock; proxy for pairings published
timer_duration_min    INT               -- NULL for Top-8 and until timer is explicitly set; null-check before ALL timing math
  -- No extra_time_seconds: Carde has no round-level extra time field.
  -- Round timer adjustments are absorbed into timer_end_datetime only.
timer_end_datetime    TIMESTAMPTZ
  -- Computed: started_at + (timer_duration_min * 60s)
  -- NULL when timer_duration_min is NULL (Top-8)
  -- Computed locally; do not read from API (server has +7-83s lag)
completed_at          TIMESTAMPTZ
  -- Stored verbatim from Carde. For Swiss: equals next round's started_at.
  -- NEVER use for duration, break time, or round-end calculations.
missing_tables_json   JSONB             -- table numbers outstanding at timer expiry
snapshot_captured_at  TIMESTAMPTZ       -- when snapshot was taken; late = unreliable
UNIQUE (tournament_id, round_number)
```

---

### `matches`

Only stored for interesting tables. See `raw_carde_matches` note.

```sql
id                          SERIAL PRIMARY KEY
tournament_id               INT NOT NULL REFERENCES app_tournaments(id)
round_id                    INT NOT NULL REFERENCES rounds(id)
round_number                INT NOT NULL
table_number                INT NOT NULL
carde_match_id              INT NOT NULL
status                      TEXT NOT NULL
time_extension_sec          INT NOT NULL DEFAULT 0
is_ghost_match              BOOLEAN NOT NULL DEFAULT FALSE
is_bye                      BOOLEAN NOT NULL DEFAULT FALSE
match_is_loss               BOOLEAN NOT NULL DEFAULT FALSE
match_is_intentional_draw   BOOLEAN NOT NULL DEFAULT FALSE
match_is_unintentional_draw BOOLEAN NOT NULL DEFAULT FALSE
deck_check_started          BOOLEAN NOT NULL DEFAULT FALSE
deck_check_completed        BOOLEAN NOT NULL DEFAULT FALSE
assigned_judge              TEXT      -- populated in Carde-only mode; NULL when PF handles coverage
result_reported_at          TIMESTAMPTZ
result_at                   TIMESTAMPTZ
  -- Computed: COALESCE(result_reported_at, updated_at)
  -- Canonical "result entered" timestamp; use this for all timing calculations
p1_user_id                  TEXT
p1_name                     TEXT
p2_user_id                  TEXT
p2_name                     TEXT
winning_player_id           TEXT
UNIQUE (tournament_id, round_number, table_number)
```

---

### `drops`

```sql
id                SERIAL PRIMARY KEY
tournament_id     INT NOT NULL REFERENCES app_tournaments(id)
player_game_id    TEXT NOT NULL
round             INT NOT NULL
table_number      INT
player_name       TEXT
is_checked        BOOLEAN NOT NULL DEFAULT FALSE
is_cancelled      BOOLEAN NOT NULL DEFAULT FALSE
added_by_name     TEXT    -- write-once: set on first sync, never overwritten on subsequent syncs
verified_by_name  TEXT    -- set only when is_checked transitions TRUE → never reset
updated_by        TEXT
source            TEXT NOT NULL DEFAULT 'purplefox'
UNIQUE (tournament_id, player_game_id, round)
```

---

### `penalties`

```sql
id              SERIAL PRIMARY KEY
tournament_id   INT NOT NULL REFERENCES app_tournaments(id)
pf_id           TEXT           -- PF's own ID; NULL if source is not PF
round           INT
player_game_id  TEXT
player_name     TEXT
description     TEXT NOT NULL
infraction_type TEXT    -- maps to PF "type" column (e.g. "Gameplay Infractions - HIDDEN CARD ERROR")
sanction        TEXT    -- maps to PF "sanction" column (e.g. "Warning", "Intellect Penalty (IP2)")
created_at      TIMESTAMPTZ NOT NULL
creator_id      TEXT
creator_name    TEXT
source          TEXT NOT NULL DEFAULT 'purplefox'
```

---

### `extensions`

```sql
id                  SERIAL PRIMARY KEY
tournament_id       INT NOT NULL REFERENCES app_tournaments(id)
round_id            INT REFERENCES rounds(id)
round               INT
  -- In PF+Carde mode: comes directly from PF tournament_logs.round column.
  -- In Carde-only mode: inferred from the round active at match fetch time.
table_number        INT NOT NULL
from_minutes        INT
to_minutes          INT
extension_minutes   INT         -- computed: to_minutes - from_minutes
action_text         TEXT        -- raw PF log string; NULL in Carde-only mode
user_id             TEXT        -- PF judge ID; NULL in Carde-only mode
created_at          TIMESTAMPTZ NOT NULL
source              TEXT NOT NULL  -- 'purplefox' | 'carde'
```

---

### `table_coverage`

PF-only. Not populated in Carde-only mode.

```sql
id              SERIAL PRIMARY KEY
tournament_id   INT NOT NULL REFERENCES app_tournaments(id)
round           INT
table_number    INT NOT NULL
covered_by      TEXT NOT NULL
first_seen_at   TIMESTAMPTZ NOT NULL
UNIQUE (tournament_id, table_number, covered_by)
```

---

### `table_judge_calls`

PF-only. Distinct from coverage — outcome of a formal judge call, not just a visit.

```sql
id              SERIAL PRIMARY KEY
tournament_id   INT NOT NULL REFERENCES app_tournaments(id)
round           INT
table_number    INT NOT NULL
judge           TEXT
judge_result    TEXT NOT NULL
first_seen_at   TIMESTAMPTZ NOT NULL
```

---

### `pf_staff`

Staff identity cache. Not players. Not app users.

```sql
id            SERIAL PRIMARY KEY
pf_user_id    TEXT NOT NULL UNIQUE
display_name  TEXT NOT NULL
last_seen_at  TIMESTAMPTZ NOT NULL
```

---

## App layer

No source dependency. Owned entirely by this tool.

---

### `app_tournaments`

Display info and lifecycle state only. All source bindings in `tournament_source_mapping`.

```sql
id          SERIAL PRIMARY KEY
name        TEXT NOT NULL
short_name  TEXT NOT NULL
is_active   BOOLEAN NOT NULL DEFAULT TRUE
is_ended    BOOLEAN NOT NULL DEFAULT FALSE
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

### `tournament_source_mapping`

Maps an app tournament to its external source identifiers. One row per source per tournament.

```sql
id                    SERIAL PRIMARY KEY
tournament_id         INT NOT NULL REFERENCES app_tournaments(id)
source                TEXT NOT NULL    -- 'carde' | 'purplefox'
external_id           TEXT NOT NULL    -- Carde tournament ID (as string) or PF UUID
is_enabled            BOOLEAN NOT NULL DEFAULT TRUE
  -- FALSE = source is configured but currently inactive (e.g. mid-event Carde-only switch)
  -- Keeps the external_id around for re-enabling; non-destructive toggle
carde_first_round_id  INT
  -- Carde only: the actual ID of round 1 from get_all_rounds response
  -- Used to anchor round ID lookups; never computed from a base ID
metadata              JSONB            -- reserved for future source-specific config
UNIQUE (tournament_id, source)
```

**Carde-only mode:** set `is_enabled = FALSE` on the `purplefox` row. Worker skips PF fetches. UI hides PF-only columns (extensions, drops, coverage, judge calls).

**New source type:** insert a new row with a new `source` value. No schema change required.

---

### `app_users`

```sql
id             SERIAL PRIMARY KEY
username       TEXT NOT NULL UNIQUE
password_hash  TEXT NOT NULL
role           TEXT NOT NULL     -- 'user' | 'admin' | 'superadmin'
is_active      BOOLEAN NOT NULL DEFAULT TRUE
created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

### `app_sessions`

```sql
id          SERIAL PRIMARY KEY
token       TEXT NOT NULL UNIQUE
username    TEXT NOT NULL REFERENCES app_users(username)
expires_at  TIMESTAMPTZ NOT NULL
ip          TEXT
user_agent  TEXT
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

### `pf_session`

Singleton row (always `id = 1`). Tracks the metadata of the last-pasted PF JWT.

**The actual JWT token is NEVER stored here.** It lives in memory only (`src/ingestion/jwtStore.ts`).
On server restart, jwtStore is empty — the UI reads `expires_at` from this table to show the correct
prompt ("JWT expired" vs. "JWT valid but needs re-paste after restart").

```sql
id          INT PRIMARY KEY DEFAULT 1   -- singleton; always upsert on id=1
set_by      TEXT NOT NULL               -- app username who pasted the JWT
set_at      TIMESTAMPTZ NOT NULL        -- when it was pasted
expires_at  TIMESTAMPTZ NOT NULL        -- decoded from JWT exp claim; displayed in UI
```

---

### `app_activity`

Replaces `user_activity`.

```sql
id          SERIAL PRIMARY KEY
event_type  TEXT NOT NULL
username    TEXT NOT NULL
ip          TEXT
user_agent  TEXT
detail      TEXT
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

### `worker_state`

Ingestion worker state per tournament. Survives restarts.

```sql
tournament_id             INT PRIMARY KEY REFERENCES app_tournaments(id)
last_rounds_fetched_at    TIMESTAMPTZ
last_matches_fetched_at   TIMESTAMPTZ
last_pf_fetched_at        TIMESTAMPTZ
current_round             INT
is_running                BOOLEAN NOT NULL DEFAULT FALSE
last_error                TEXT
updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

## Open items

**P0.1 API exploration is complete.** All items below are resolved.

| Item | Resolution |
|---|---|
| Selective match ingestion strategy | `status=in_progress` confirmed functional. Worker fetches only outstanding matches. |
| `timer_end_datetime` in live events | Lives on `v2/organize/events/{id}/detail/` only. Compute locally: `started_at + (timer_duration_min * 60s)`. |
| `result_reported_at` behavior | NULL for in-progress; non-null on completed. Draws confirmed: `result_reported_at` null, `match_is_intentional_draw: true`. |
| PF table/column names | All confirmed. `tournament_penalities` typo real. `tournament_drops` (not `drops`). See `agent/PURPLEFOX.md`. |
| PF round attribution mechanism | `tournament_logs` has direct `round` column. No timestamp inference needed. |
| `raw_pf_judge_calls` source | `tables.judgeResult` column — same row as coverage. Free-text, not enum. |
