# Tool Purpose

## What it does

A local-network dashboard for tournament staff running TCG events. It pulls data from two external systems (PurpleFox/Supabase and Carde.io), stores it in a local SQLite database, and presents it as a real-time, unified view.

Key things it surfaces that neither source provides on its own:

- Live drops list with check-off workflow (who dropped, which round, verified by whom)
- Time extensions per table with judge attribution
- Penalties feed with repeat-offender detection
- Judge activity log (which tables were visited, covered, and had calls)
- Round timing breakdown: scheduled vs. actual end, break duration, outstanding tables at timer expiry
- Post-event analytics: round turnover, seatings turnover, total duration per round

## Who uses it

- **Scorekeepers**: monitor drops in real time, track which tables still need results, manage the check-off list
- **Head Judges**: see which tables received extensions and why, identify patterns (slow players, contested calls), keep rounds on schedule
- **Tournament Organizers**: post-event reporting — round timing, performance metrics, insights to share with publishers or internal planning

## The gap it fills

Carde.io handles pairings, results, and the clock. PurpleFox handles judge activity, extensions, drops, and penalties. Neither talks to the other, and neither gives you a single coherent view of how a round actually ran. This tool is that single view.

It also compensates for specific weaknesses in each system:

- Carde's `completed_at` is unreliable as a "round end" time — this tool computes the real end from the timer data
- Neither system tells you how many outstanding tables had extensions vs. didn't at timer end — this tool cross-references both

**Carde-only mode:** When PurpleFox is not in use (e.g. smaller events), the tool runs against Carde alone. Extensions come from Carde `time_extension_seconds` on match objects. Drops, penalties, coverage, and judge calls are not available. Toggle via `tournament_source_mapping.is_enabled`.

---

## Operational flow

### What a user needs to do before an event

1. Create a tournament record in the admin UI and configure its source mapping (Carde event ID, PF tournament UUID if applicable)
2. Start the server (`npm start`) on a machine accessible to staff on the local network
3. In PF+Carde mode: a logged-in PurpleFox user must paste their JWT into the tool via the Session panel — without this, PF syncs will fail

### During an event

- The ingestion worker polls automatically on a configurable interval per active tournament
- In PF+Carde mode: the PF JWT has ~48h validity; if expired, auto-sync falls back to Carde-only until re-pasted
- Drops should be checked off in the tool as the scorekeeper processes them
- The tool can be restarted between rounds — worker state is persisted to the DB; only the PF JWT needs to be re-entered (it's in-memory only)

### After an event

- Round timing analytics (Insights tab) are available immediately after the final sync
- The TO can mark the tournament as ended via `/api/end-tournament` to freeze the `is_ended` flag
- StageTimer logs (if the event used StageTimer) can be imported manually for post-event round timing analysis — they are not synced automatically

---

## What is real-time vs. post-event only

| Feature | Real-time | Notes |
|---|---|---|
| Drops list | ✅ | Updates on every sync |
| Extensions feed | ✅ | Updates on every sync |
| Penalties feed | ✅ | Updates on every sync |
| Judge activity | ✅ | Updates on every sync |
| Round timing (start/end) | ✅ | From Carde.io via sync |
| Outstanding tables at timer end | ⚠️ | Only accurate if sync happens at the right moment — see `missing_tables_json` in `AGENT_CONTEXT.md` |
| StageTimer-derived timing | ❌ | Post-event manual import only |
| Round turnover / seatings turnover | ❌ | Computed post-event from combined data |

---

## Current limitations

- **`missing_tables_json` is timing-sensitive**: the snapshot of outstanding tables is only accurate if a sync happens close to when the round clock expires. A late sync produces an incomplete or empty snapshot. This is the single most important reliability gap.
- **StageTimer data is not integrated**: StageTimer logs must be processed manually. The tool has no automated way to ingest them.
- **PurpleFox JWT is in-memory**: server restarts require re-pasting the JWT. It is not persisted to the DB.
- **PF `tables`, `table_status`, `tournament_time` are current-round-only**: these PF tables are wiped on every round advance. Coverage and judge call history only exists for the current round. Historical round data does not exist in PF for these tables — an empty response means the round advanced, not that there was no activity.
- **Partial venue coverage**: on large events, StageTimer and PurpleFox may only cover a section of the venue (e.g., featured tables). The rest of the event runs without this tool's visibility.
