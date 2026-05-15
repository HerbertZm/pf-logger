# PurpleFox

PurpleFox is a judge management tool used alongside Carde.io at TCG events. It runs as a separate web app and stores its data in Supabase (Postgres). This tool reads from PurpleFox's Supabase tables via the REST API using a judge's JWT.

## Uses

### Drop management

Tracks players who have dropped from the event mid-tournament. Each drop has a `tableNumber`, `round`, and `isChecked` flag (whether the scorekeeper has processed it). The tool surfaces these in a check-off workflow so nothing gets missed.

### Time extensions

When a judge grants a player extra time at their table (due to a judge call, deck check, etc.), it's logged in PurpleFox as a `tournament_logs` entry: `"Change time from Xmin to Ymin"`. This is the **only** source of extension data — extensions are **not** entered into Carde.io for our events.

### Penalties

Warnings, game losses, match losses, and DQs are recorded in PurpleFox. Includes who issued the penalty, the infraction, the remedy, and the table. The tool surfaces these with repeat-offender detection.

### Table coverage and judge results

Judges log which tables they visited (`coveredBy`) and the outcome of any judge call at that table (`judgeResult`). This is used for the judge activity feed and for correlating extensions with specific calls.

### Player data

Player names, IDs, and table assignments are available via the `players` table. Used to resolve UUIDs to display names throughout the tool.

---

## Auth and sync behavior

### JWT authentication

PurpleFox data is behind Supabase auth. To sync, a staff member must:

1. Log into PurpleFox in their browser
2. Copy their JWT from the browser (or from a PF API response header)
3. Paste it into this tool via the Session tab (`/api/set-token`)

The tool stores the JWT in `_state["token"]` **in memory only** — it is lost on server restart. The JWT has an expiry; once expired, all syncs will fail with 401 until a new token is pasted. The tool decodes and validates the expiry on receipt and displays it in the Session tab.

**Implication for agents**: Never assume a valid PF JWT is present. If sync fails with a 401 or token-related error, the fix is always human intervention (re-paste the JWT) — not a code change.

### Sync is pull-only and on-demand

PurpleFox does not push data to this tool. Every data fetch is triggered by a user hitting Sync (or the auto-sync interval). There are no webhooks, no real-time subscriptions. Data is only as fresh as the last successful sync.

---

## Data model details

### Drop upsert — three-pass logic

Drops use a deliberate three-pass upsert rather than a simple `INSERT OR REPLACE`, because two fields must only be written once and must not be overwritten by a later sync:

1. **`INSERT OR IGNORE`** — inserts new drops without touching existing rows
2. **UPDATE unchecked** — for existing rows where `is_checked = 0`, update mutable fields (table number, round, etc.) and stamp `added_by_name` from the current user cache if not yet set
3. **UPDATE checked** — for rows where `is_checked` just transitioned to 1, stamp `verified_by_name`

The result: `added_by_name` is set once on first insert and never overwritten. `verified_by_name` is only set when the drop is checked off, and never reset. A sync that arrives after check-off will not clear `verified_by_name`.

**Do not replace this with `INSERT OR REPLACE`** — it would delete and re-insert rows, losing both name stamps.

### Coverage vs. judge results

These are two distinct concepts stored in separate tables:

- **Coverage** (`table_coverage`): a judge logging that they *visited* a table — presence, not outcome. Records `covered_by` (judge name) and when. Used for "which tables had a judge stop by."
- **Judge results** (`table_judge_results`): the *outcome* of a judge call at a table — what ruling was made. Used for the judge activity feed and correlating with penalties/extensions.

A table can have coverage without a judge result (judge checked in, no formal call) and theoretically a result without coverage (data entry edge case).

---

## Gaps

### No pairings or round structure

PurpleFox has no concept of who is playing whom or which round a table belongs to beyond what the scorekeeper enters manually. Pairings come entirely from Carde.io.

### `tournament_logs` is not a general activity log

Despite the name, `tournament_logs` in the PurpleFox schema only contains time-extension entries. There is no general audit trail of judge or scorekeeper actions in this table.

### Extensions are not linked to rounds

PurpleFox extension entries include a timestamp and table number but no explicit round number. Round attribution must be inferred by cross-referencing the timestamp with the round timer windows from Carde.io.

### Schema typo

The penalties table in Supabase is `tournament_penalities` (note the extra 'i'). This is a typo in the actual PurpleFox schema and must be spelled exactly this way in all queries.

### Column naming is camelCase

All PurpleFox/Supabase columns use camelCase (`tournamentId`, `tableNumber`, `isChecked`, etc.), which differs from the local SQLite schema (snake_case). Transformation happens in `fetch_and_store()`.

### No timer or round-end data

PurpleFox has no knowledge of when a round clock started, expired, or how many tables were outstanding. That data lives entirely in Carde.io.
