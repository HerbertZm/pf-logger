# Other Tournament Softwares

Overview of tournament management tools beyond what this project currently integrates with, for context on future expansion.

## Uses

### EventLink (Magic: The Gathering — Wizards of the Coast official)

- The official WotC platform for sanctioned Magic events (FNM, PPTQs, RCQs, etc.)
- Handles pairings, standings, match results, and player registration
- Provides a judge app for penalties and time extensions
- Rounds are 50 minutes for most formats

### Melee.gg (Magic: The Gathering — community)

- Used for large community and semi-professional events (SCG, CFB, etc.)
- Also used by some WotC-adjacent events
- Has a more feature-rich TO interface than EventLink
- Provides player profiles and historical match data via public APIs

### Carde.io (Riftbound, Lorcana)

- See `CARDE_IO.md` for full detail
- Currently the only scorekeeper software integrated with this tool

### PurpleFox (judge management — used alongside Carde.io)

- See `PURPLEFOX.md` for full detail
- Not a standalone scorekeeper — it's a supplement to Carde.io

### StageTimer (optional broadcast timer)

- A third-party tool used to display the round clock on a screen for players
- **Optional and situational** — not all events use it, and within a multi-tournament convention, some tournaments may have a timer screen while others don't
- When used, it only covers the tables it was deployed for (e.g., the featured section of the venue); the rest of the event runs without a broadcast clock
- Logs export in UTC; must be converted to the event's local timezone for analysis
- Not integrated into the tool directly — logs are used manually for post-event analysis when available

---

## Gaps (what none of these provide out of the box)

### No unified cross-tool view

Each software only knows about itself. A judge working an event that uses both Carde.io (pairings) and PurpleFox (judge tools) has to switch between both. This tool exists to bridge that.

### No round-timing analytics

None of these tools expose a post-event breakdown of how long each round actually took, how much overtime there was, or how many tables were outstanding at the clock. This tool computes all of that.

### No extension-to-round correlation

Time extensions in PurpleFox (and judge apps) are timestamped but not round-tagged. There's no built-in way to see "in Round 5, 12 tables got extensions, 3 of which were still playing when the clock expired." This tool reconstructs that.

### No drop check-off workflow in Carde.io

When a player drops mid-round, Carde.io records it but doesn't provide a workflow for the scorekeeper to confirm it was processed. PurpleFox has the `isChecked` flag; this tool surfaces it as an interactive list.

### EventLink / Melee not yet integrated

Expanding this tool to support Magic events would require integrating with EventLink or Melee. The architecture is generic enough to support it — the main work would be mapping their APIs to the same SQLite schema and UI. Key differences to account for:

- 50-minute round time (vs. 60 for Riftbound)
- Different judge management tools (no PurpleFox equivalent for Magic — penalties and extensions would need to come from a different source or be entered manually)
- Melee has a public API; EventLink's API access is restricted to WotC partners
- The data points needed to match current feature parity: per-round `started_at`, `completed_at`, `timer_duration_minutes`; per-match `table_number`, `result`, `updated_at`; drop list with player IDs; penalty log with infraction/remedy/judge; extension log with table/duration/timestamp

### PurpleFox with non-Carde software

PurpleFox is not tied to Carde.io at the data level — it operates independently and stores everything in its own Supabase instance. In theory it could be used alongside other scorekeeper software (e.g., Melee). However, this has not been tested, and the current integration assumes Carde.io as the pairings/results source. Any expansion would need to verify that PurpleFox's table numbers and round references align with the new scorekeeper software's data.
