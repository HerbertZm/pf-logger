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
- PurpleFox extension logs don't link to rounds — this tool correlates them by timestamp
- Neither system tells you how many outstanding tables had extensions vs. didn't at timer end — this tool cross-references both

---

## Operational flow

### What a user needs to do before an event

1. Add the tournament to the `TOURNAMENTS` dict in `serve.py` with `carde_event_id` and `carde_base_round_id`
2. Start the server (`python serve.py`) on a machine accessible to staff on the local network
3. A logged-in PurpleFox user must paste their JWT into the tool via the Session tab — without this, syncs will fail (PurpleFox data is behind auth)

### During an event

- Staff hit **Sync** to pull the latest data from both PurpleFox and Carde.io. There is no push or webhook — data is only as fresh as the last sync.
- The tool auto-syncs on a timer when a valid PF JWT is present; if the JWT expires, auto-sync stops and the user must re-paste it
- Drops should be checked off in the tool as the scorekeeper processes them
- The tool does not need to be running continuously — it can be restarted between rounds, though the PF JWT will need to be re-entered (it's in-memory only)

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
- **Extensions are not round-tagged in PurpleFox**: the tool infers which round an extension belongs to by matching its timestamp against the round timer windows. This inference can be wrong if clocks are manipulated or the event runs late.
- **Partial venue coverage**: on large events, StageTimer and PurpleFox may only cover a section of the venue (e.g., featured tables). The rest of the event runs without this tool's visibility.
