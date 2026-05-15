# pf-logger — Database Schema Design

_Working document for Phase 0. Reflects confirmed design decisions. Sections marked **[TBD: P0.1]** depend on API exploration results before they can be finalized._

Last updated: 2026-05-14

---

## Design principles

- **Three-layer model:** raw → normalized → app. Each layer has a single owner and a single direction of data flow.
- **Raw is append-only.** Never mutate a raw record after insert. It is the audit trail and the re-processing source.
- **Normalized is what the app queries.** Derived from raw by the ingestion worker. Business logic lives here.
- **App layer has no source dependency.** `app_*` tables are owned entirely by this tool.
- **TIMESTAMPTZ everywhere.** Every timestamp column on every table. No TEXT timestamps, no silent UTC assumptions. Carde timestamps (EDT for US events) are converted to UTC at ingestion.
- **Selective match storage.** Player-identifying match records are only stored for tables with tracked events (drops, extensions, penalties, coverage). Full match lists are fetched into memory to compute `missing_tables_json`, then discarded. See [TBD: P0.1] below.
- **`timer_end_datetime` is always computed locally:** `started_at + (timer_duration_minutes * 60) + extra_time_seconds`. Never read from the API; not present in completed event responses.
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
timer_duration_min    INT           -- NULL for Top-8 and playoff rounds
extra_time_seconds    INT NOT NULL DEFAULT 0
  -- NOTE: API returns this as "extra_time_seconds" in some responses
  -- and "additional_time_seconds" in others. Parser must check both keys.
carde_status          TEXT          -- UPCOMING | SCHEDULED | ACTIVE | COMPLETE
pairings_status       TEXT
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

Source: PurpleFox drops table via Supabase REST

```sql
id                SERIAL PRIMARY KEY
fetched_at        TIMESTAMPTZ NOT NULL
tournament_id     INT NOT NULL REFERENCES app_tournaments(id)
pf_tournament_id  TEXT NOT NULL   -- PF UUID
player_game_id    TEXT NOT NULL
round             INT
table_number      INT
player_name       TEXT
is_checked        BOOLEAN NOT NULL DEFAULT FALSE
is_cancelled      BOOLEAN NOT NULL DEFAULT FALSE
updated_by        TEXT
raw_payload       JSONB
```

---

### `raw_pf_penalties`

Source: PurpleFox `tournament_penalities` table (note: typo in PF schema — extra 'i' — must be spelled this way in all queries)

```sql
id                SERIAL PRIMARY KEY
fetched_at        TIMESTAMPTZ NOT NULL
tournament_id     INT NOT NULL REFERENCES app_tournaments(id)
pf_tournament_id  TEXT NOT NULL
pf_id             TEXT NOT NULL    -- PF's own ID for this record
round             INT
player_game_id    TEXT
player_name       TEXT
description       TEXT
infraction        TEXT
sanction          TEXT
created_at        TIMESTAMPTZ
creator_id        TEXT
creator_name      TEXT
raw_payload       JSONB
```

---

### `raw_pf_extensions`

Source: PurpleFox `tournament_logs` table. Contains only time-extension entries (despite the name, not a general activity log).

```sql
id                SERIAL PRIMARY KEY
fetched_at        TIMESTAMPTZ NOT NULL
tournament_id     INT NOT NULL REFERENCES app_tournaments(id)
pf_tournament_id  TEXT NOT NULL
table_number      INT NOT NULL
action            TEXT NOT NULL    -- e.g. "Change time from 5min to 10min"
from_minutes      INT              -- parsed from action text
to_minutes        INT              -- parsed from action text
user_id           TEXT             -- PF judge user ID
created_at        TIMESTAMPTZ NOT NULL
raw_payload       JSONB
```

---

### `raw_pf_coverage`

Source: PurpleFox table coverage — judge visits (presence, not outcome)

```sql
id                SERIAL PRIMARY KEY
fetched_at        TIMESTAMPTZ NOT NULL
tournament_id     INT NOT NULL REFERENCES app_tournaments(id)
pf_tournament_id  TEXT NOT NULL
table_number      INT NOT NULL
covered_by        TEXT NOT NULL    -- judge name or PF user ID
first_seen_at     TIMESTAMPTZ NOT NULL
raw_payload       JSONB
```

---

### `raw_pf_judge_calls`

Source: PurpleFox judge call outcomes — distinct from coverage (a table can have coverage without a formal call)

```sql
id                SERIAL PRIMARY KEY
fetched_at        TIMESTAMPTZ NOT NULL
tournament_id     INT NOT NULL REFERENCES app_tournaments(id)
pf_tournament_id  TEXT NOT NULL
table_number      INT NOT NULL
round             INT
judge             TEXT
judge_result      TEXT NOT NULL
first_seen_at     TIMESTAMPTZ NOT NULL
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
carde_status          TEXT              -- UPCOMING | SCHEDULED | ACTIVE | COMPLETE
started_at            TIMESTAMPTZ       -- when TO started clock; proxy for pairings published
timer_duration_min    INT               -- NULL for Top-8; null-check before ALL timing math
extra_time_seconds    INT NOT NULL DEFAULT 0
timer_end_datetime    TIMESTAMPTZ
  -- Computed: started_at + (timer_duration_min * 60s) + extra_time_seconds
  -- NULL when timer_duration_min is NULL (Top-8)
  -- Never read from API; must always be computed locally
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
infraction      TEXT
sanction        TEXT
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
  -- Inferred: most recent round where rounds.started_at <= extensions.created_at
  -- If ambiguous (gap between rounds), attributed to the last active/complete round
  -- NULL only if no rounds exist yet (should not happen in practice)
round               INT
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

## Open items (pending P0.1 API exploration)

| Item | Blocked on | Notes |
|---|---|---|
| ~~Selective match ingestion strategy~~ | ~~P0.1 Carde~~ | **Resolved:** `status=in_progress` confirmed functional. Worker fetches only outstanding matches. |
| `timer_end_datetime` in live events | P0.1 Carde | Absent from completed events — confirm if present for active events |
| `result_reported_at` behavior | P0.1 Carde | Confirmed null for in-progress matches; verify behavior on draws in completed response |
| PF table/column names | P0.1 PF | Verify `tournament_penalities` typo and all camelCase field names |
| PF round attribution mechanism | P0.1 PF | Confirm extensions have no round field; timestamp cross-ref is the only path |
| `raw_pf_judge_calls` source | P0.1 PF | Confirm this comes from a separate PF table or is a field on the coverage record |
