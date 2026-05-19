# pf-logger — UI/UX Design Brief

_Context file for a Claude Design session. Contains everything needed to produce wireframes, a design system spec, or a component redesign without access to the codebase._

---

## What this tool is

**pf-logger** is a real-time tournament operations dashboard used by judge staff during live TCG (Trading Card Game) events — Magic: The Gathering, Lorcana, Riftbound. Events range from ~80 to ~400+ players across multiple simultaneous tournaments in one venue.

This is a **local-network tool**: deployed on a laptop, accessed from phones and tablets by judges walking the floor. It is never public-facing.

---

## Who uses it

| Role | Device | Primary use |
|---|---|---|
| Head Judge (HJ) | Laptop or tablet | Monitors all rounds, makes decisions on drops/extensions, reviews penalties |
| Floor Judges | Phone or tablet | Check outstanding tables, log coverage, reference pairings |
| Tournament Organizer (TO) | Laptop | Adds extensions, monitors overall event progress |

**Critical context:**
- Users are on their feet, often in loud, bright venues
- Phone use is one-handed in portrait orientation
- Time pressure is real — a judge checking this mid-round needs information in under 3 seconds
- The HJ may be tracking 2–3 simultaneous tournaments from the same view

---

## Current structure (tabs)

1. **Dashboard / Main** — round-by-round view showing current round status, outstanding tables, timer countdown, drops, extensions, and penalties per round
2. **Logs** — filterable chronological feed of all drops, extensions, and penalties across all rounds
3. **Insights** — aggregated stats per round: extension counts, average extension length, outstanding table count at round end, judge coverage
4. **Data** — raw data explorer (tables, pairings by round)
5. **Session** — PurpleFox JWT management (paste token, see expiry)
6. **Guide** — usage documentation for judges

---

## Current pain points

### Layout & hierarchy
- No visual hierarchy — every element has roughly equal weight; critical info (active round, outstanding tables, timer) doesn't stand out
- Inline `style=""` attributes everywhere — no consistent spacing, color, or type scale
- Round blocks stack vertically with no way to see a cross-round summary at a glance
- The countdown timer is a small number in a block header, not prominently placed

### Mobile / touch
- Layout breaks below ~800px wide — effectively unusable on phones
- Most interactive elements are smaller than 44px touch targets
- No sticky header/action bar — Sync and Fetch buttons scroll off screen
- Long Logs tab list requires excessive scrolling to find current-round entries

### Information density vs. clarity
- Outstanding tables, drops, extensions, and penalties are all shown at once with no urgency distinction — everything looks the same whether there are 0 or 20 outstanding tables
- No visual cue for "this round needs attention" vs. "this round is clean"
- Extensions and drops use the same neutral styling regardless of count or urgency

### Wayfinding
- Tabs are horizontal text buttons — small, hard to tap on mobile
- No indication of unread/new data on tabs
- No persistent context showing "which tournament / which round am I looking at"

### Forms & management
- JWT paste is buried in its own tab with no status feedback
- No inline editing for anything — all management requires navigating away from the active view

---

## Design goals

### Primary
1. **Heads-up clarity at a glance** — the active round's status (timer, outstanding tables, any issues) should be readable in under 2 seconds without scrolling
2. **Mobile-first** — the primary field use case is portrait phone; tablet and laptop are secondary
3. **Urgency hierarchy** — visual treatment must distinguish "all good" from "needs attention" from "urgent" without relying on reading numbers

### Secondary
4. **Consistent component language** — one button style, one panel style, one badge style, expressed as a design token system (CSS variables)
5. **Touch-safe** — all interactive elements 44px minimum tap target
6. **Persistent context** — tournament name and current round always visible regardless of which tab/view is open
7. **Tab feedback** — unread counts or urgency badges on tabs

---

## Key screens to redesign

### 1. Active round view (most important)
Shows the current round. Must surface immediately:
- Time remaining on the round clock (large, color-changes as it approaches 0 and goes negative)
- Outstanding table count (tables not yet reported a result)
- Whether any outstanding tables have extensions — and how many
- Drop count this round
- Penalty count this round

Secondary:
- List of outstanding table numbers (collapsible)
- List of extensions this round (table number, duration)

### 2. Cross-round summary (Insights / trend)
Compact view of all rounds in the event:
- One row per round
- Columns: drops, extensions, outstanding at end, time called vs. actual (when available)
- Cells with 0 show as "—" to reduce noise
- Row highlight when a round had notable issues

### 3. Logs feed
- Filterable list of all drops/extensions/penalties in the event
- Groups by round with collapsible headers
- Quick filter presets: "This round", "Extensions", "Drops", "Penalties"
- Each entry shows: type (colored badge), player name, table, round, who logged it, timestamp

### 4. Manage tab (superadmin)
- Tournament list with quick add/edit
- User management table (role-coded badges)
- Active sessions with revoke

---

## Design constraints

- **React + Vite** — frontend is a React 18 TypeScript app built with Vite. Design tokens are CSS custom properties in `tokens.css`; component styles are plain CSS files co-located with components. No external component library (MUI, Chakra, etc.) — the design system is built in-house.
- **LAN deployment** — no CDN, no external fonts. System font stack only.
- **Dark mode preferred** — venue lighting is variable; dark background reduces eye strain
- **No animations on data** — the background worker syncs data on a polling cycle; animated transitions on data updates would be jarring and disorienting during live use
- **No external UI dependencies** — components must be buildable without network access during the event (no CDN-loaded icon libraries, no Google Fonts)

---

## Color semantics to encode

| State | Meaning | Example trigger |
|---|---|---|
| `--urgent` (red) | Needs immediate action | Round >15 min past time called, 5+ outstanding tables |
| `--warning` (amber) | Worth watching | Round past time called, 1–4 outstanding tables |
| `--success` (green) | Clean / on track | Round on time, 0 outstanding tables |
| `--info` (blue) | Neutral information | Sync status, JWT expiry |
| `--muted` (gray) | De-emphasized | Zero-value cells, completed rounds |

---

## What success looks like

A floor judge picks up their phone mid-round and within 3 seconds knows:
1. How much time is left on the current round
2. How many tables haven't reported yet
3. Whether they need to do anything right now

A head judge on a laptop can switch between two simultaneous tournaments, see the current state of each at a glance, and act on a drop or extension without navigating more than one level deep.
