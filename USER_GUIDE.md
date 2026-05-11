# PurpleFox Exporter — User Guide

This tool gives tournament staff a live, searchable view of everything happening at a PurpleFox-run event: drops, judge activity, time extensions, penalties, and round timing — all in one place, without needing to dig through the PurpleFox app.

---

## Signing in

When you open the page you'll see a sign-in box. Enter your username and password and press **Sign in** (or hit Enter). Your session stays active for 7 days, so you won't need to sign in again on the same device unless you log out manually.

The **Logout** button is in the top-right corner of the header. Your current username is shown next to it.

There are two users:

| User | Access |
|------|--------|
| `admin` | Full access — all tabs including the Data tab and admin-only sections of the Schema tab |
| `hj` | Standard access — all tabs except Data |

---

## The tournament selector

The dropdown in the top-right header lets you switch between tournaments. The currently selected tournament determines what all tabs show. Tournaments marked **(ended)** have auto-refresh disabled.

---

## Tabs — available to all users

### Logs

The main feed. Shows every recorded event grouped by round — drops, time extensions, judge seats, table results, and penalties — most recent round first.

**Fetching data**
- When you first open the page, cached data loads automatically — no action needed.
- To pull the latest data from PurpleFox, click **Fetch logs**. This requires a PurpleFox JWT token (see the Session tab). If you don't have one, the page still shows everything that was last saved.
- **Auto-refresh** (dropdown, top-left) keeps fetching in the background on a timer. 30 seconds is a good default during an active event; turn it off for ended events.

**Filtering**
- **Round filter** — narrow the feed to a single round.
- **Search box** — filters by player name, table number, judge name, or any text in an entry.
- **Type checkboxes** — show/hide drops, time extensions, penalties, etc. independently.
- **Show new only** — highlights only entries that appeared since your last fetch.

**Stats row**
The six numbers at the top (Total, Drops, Time ext, Penalties, Judge, New) update automatically as you filter.

**Exporting**
- **Export CSV** — every visible row as a spreadsheet.
- **Export JSON** — same data with full raw fields attached, useful for deeper analysis.

**Clear seen hashes** — resets the "new" tracking so the next fetch marks everything as new again. Useful at the start of a new day or event.

---

### Insights

A round-by-round summary of what happened during each round. For each round you'll see:

- **Timer**: when the round started, when time was called, and when the round was fully completed.
- **Extensions**: how many tables received extra time, which table had the longest extension, and whether any table got extended more than once.
- **Outstanding at time called**: tables that still hadn't submitted a result when the clock hit zero.
- **Drops**: all drops recorded during that round.
- **Penalties**: all penalties issued, broken down by type.

Rounds are collapsed by default — click any round header to expand it. The most recent round opens automatically.

---

### Infractions

A dedicated view of all penalties across the entire event. Includes:

- A summary alert if any player has received multiple penalties.
- Total penalty count and a breakdown by type (Slow Play, Late to Match, etc.).
- Full penalty table with player name, round, type, sanction, and who issued it.

---

### Session

This is where you paste your **PurpleFox JWT token** to enable live syncing from PurpleFox.

**Why you need it:** PurpleFox stores event data in a private database. The only way to read it is to authenticate as a logged-in user. Your token is the proof of identity.

**How to get your token:**
1. Open PurpleFox in a browser and sign in.
2. Open browser DevTools (F12), go to **Application → Local Storage** (Chrome) or **Storage → Local Storage** (Firefox).
3. Find the entry that contains a long string starting with `eyJ` — that's your JWT.
4. Copy it and paste it into the **Token** field here, then click **Save token**.

The token is stored only in server memory — it's never written to disk and disappears when the server restarts. It's typically valid for about an hour before you need a fresh one.

The status indicator shows whether the token is active, how much time is left, and who set it.

---

### Debug

Tools for querying the PurpleFox database directly. Useful for exploring what data is available or diagnosing sync issues. Requires a valid token in the Session tab.

- **Query a table**: type a table name (e.g. `tournament_drops`) and optional filter parameters, then click **Run query**.
- **Probe all tables**: tests every known table name against the current tournament and shows which ones return data.
- **Fetch Supabase schema**: pulls the database schema visible to the logged-in user.

---

### Guide

This tab — a quick reference for all features, split by role.

---

### Schema

Documents the internal database structure: every table, every column, where the data comes from, and what it means. Also lists all server API endpoints.

The **Run backfill** button re-fetches timing data from carde.io for both tournaments. Use this if round start/end times appear missing after an event.

---

## Tabs — admin only

### Data

A raw SQLite database browser. Shows all 12 local tables as collapsible sections. Data loads only when you expand a section — re-opening a previously loaded section keeps the rows already fetched. A **Load more** button appears when a table has more rows than the first page.

Useful for: verifying what's actually stored, debugging sync issues, auditing specific records.

### Schema — admin extras

When signed in as admin, the Schema tab has two extra sections:

- **carde.io API reference** — full documentation of every carde.io endpoint the tool calls, with field names, types, pagination details, and known tournament ID mappings. Includes the actual token mechanism.
- This section is hidden from `hj` even in the HTML source.

---

## The "End event" button

This marks the selected tournament as ended. It:
- Stops auto-refresh permanently for that tournament.
- Adds **(ended)** to the tournament name in the selector.
- Has no effect on stored data — nothing is deleted.

Use it after the event is fully over to prevent unnecessary background polling.

---

## Connection status

The top-right corner shows:
- **● live** (green) — last fetch succeeded.
- **● offline** (grey) — not fetched yet this session.
- A timestamp of the last successful fetch.

---

## Troubleshooting

**"No token and no cached data"** — Go to the Session tab and paste a PurpleFox token, then fetch.

**Data looks stale** — Click **Fetch logs** manually. If that fails, check the Session tab — your token may have expired.

**The page asks me to sign in again** — Your session expired (7 days) or the server was restarted. Sign in again; all your data is still in the database.

**Round timing shows "—" for start/end times** — Timing data comes from carde.io, not PurpleFox. Go to the Schema tab and click **Run backfill** to pull it in.
