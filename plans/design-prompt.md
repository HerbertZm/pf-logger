# Claude Design Prompt — pf-logger UI/UX Redesign

_Paste the content below this line directly into a Claude Design session._

---

I need a complete UI/UX redesign for a real-time tournament operations dashboard called **pf-logger**. It's a local-network web app used by judge staff at live TCG (Trading Card Game) events — Magic: The Gathering, Lorcana, Riftbound. Events range from 80 to 2000+ players.

Please produce: a design token spec, a component inventory, a navigation/layout spec, and wireframes or mockups for the key screens listed below. Use the Figma Connector/MCP to accomplish it. My account should have a project called "PF Logger" (https://www.figma.com/files/project/602934209) where you can add different files if needed

---

## Who uses this

| Role | Device | Primary need |
|---|---|---|
| Head Judge | Laptop or tablet | Monitor all rounds, act on drops/extensions/penalties |
| Floor Judges | Phone (portrait, one-handed) | Check outstanding tables, reference pairings |
| Tournament Organizer | Laptop | Monitor event progress, review insights |
| Admin | Laptop | Add new events, tournaments. Manage API keys, insights, etc |

Users are on their feet in loud, bright venues. A floor judge needs to read the current round status in under 3 seconds, one-handed, in bright lighting.

---

## Current structure (6 tabs)

1. **Dashboard** — round-by-round view: timer countdown, outstanding tables, drops, extensions, penalties per round
2. **Logs** — chronological feed of all drops, extensions, and penalties, filterable by round and type
3. **Insights** — aggregated stats per round: extension counts/averages, outstanding table count at round end, judge coverage
4. **Data** — raw pairings explorer by round
5. **Session** — PurpleFox JWT paste and expiry status
6. **Guide** — usage documentation

---

## Current pain points to fix

- No visual hierarchy — critical info (active round, outstanding tables, timer) has the same weight as everything else
- Layout breaks below ~800px — unusable on phones
- Touch targets smaller than 44px throughout
- Countdown timer is a small number in a block header — should be the most prominent element
- Sync/Fetch buttons scroll off screen on long pages — no sticky action bar
- Everything looks the same whether there are 0 or 20 outstanding tables — no urgency treatment
- Tabs are small text buttons — hard to tap on mobile, no unread indicators
- No persistent context showing which tournament/round is active across tab switches

---

## Design goals

1. **Heads-up clarity** — active round status (timer, outstanding tables, issues) readable in under 3 seconds without scrolling
2. **Mobile-first** — portrait phone is the primary field use case; tablet and laptop are secondary for most users but primary for TO and Admins
3. **Urgency hierarchy** — visual treatment must distinguish "all good" / "worth watching" / "needs immediate action" without reading numbers
4. **Touch-safe** — all interactive elements minimum 44×44px
5. **Persistent context** — tournament name and current round always visible regardless of active tab
6. **Tab feedback** — unread counts or urgency badges on tabs

---

## Technical constraints (hard limits)

- **React 18 + Vite** — the frontend is a React TypeScript app. Design tokens are CSS custom properties in a `tokens.css` file. No external component library (MUI, Chakra, etc.) — all components are built in-house. Component styles are plain CSS files co-located with their component, referencing tokens via `var(--token-name)`. If you believe that using a library like MUI or Tailwind will make things easier and improve performance and development times, bring it up to discuss before generating designs.
- **Minor external fonts or icon CDNs** — This app will run in a "small" VPS and wants to be fast. Try to use modern assets but ensure that there are slow-network fallbacks that look good
- **Dark mode by default** — venue lighting is variable; dark background reduces eye strain in both bright and dim environments.
- **No animations on data** — the app refreshes data on a background polling cycle. Animated transitions on data updates would be jarring. Static state changes only.
- **No Tailwind, no CSS-in-JS** — design tokens via CSS custom properties only. The token surface must be inspectable and overridable without a build step. If you believe that using a library like MUI or Tailwind will make things easier and improve performance and development times, bring it up to discuss before generating designs.

---

## Color semantics to encode

| Token | Meaning | Example trigger |
|---|---|---|
| `--color-urgent` | Needs immediate action | Round >15 min past timer, 5+ outstanding tables |
| `--color-warning` | Worth watching | Round past timer, 1–4 outstanding tables |
| `--color-success` | Clean / on track | Round on time, 0 outstanding |
| `--color-info` | Neutral information | Sync status, JWT expiry |
| `--color-muted` | De-emphasized | Zero-value cells, completed rounds |

---

## Source-conditional UI

The app supports two modes per tournament: **Carde + PurpleFox** (full) and **Carde-only**. Some UI elements only exist when PurpleFox is enabled. The design must account for this — columns and sections disappear gracefully, not leaving blank space or broken layouts.

| Element | Available in |
|---|---|
| Drops list | Carde + PF only |
| Extensions list | Both (source changes, column stays) |
| Judge coverage | Carde + PF only |
| Judge call outcomes | Carde + PF only |
| Round timer, outstanding tables | Both |
| Pairings / match data | Both |

---

## Data freshness model

Data is updated by a **background ingestion worker**, not by user-triggered syncs. The UI should show "last updated X seconds ago" persistently and offer a manual re-trigger, but should not imply that user action is the only path to fresh data. Worker errors (stale data, JWT expired) need a clear but non-alarming treatment.

---

## Key screens to design

### Screen 1 — Active Round View (most important)

The main view when an event is running. Must surface immediately without scrolling:

- Time remaining on the round clock (large, color-shifts as it approaches 0 and goes negative)
- Outstanding table count (tables without a result)
- How many outstanding tables have extensions
- Drop count this round
- Penalty count this round

Secondary (collapsible or below the fold):

- List of outstanding table numbers
- List of extensions this round (table number, duration granted)

### Screen 2 — Cross-Round Summary

A compact all-rounds view in the Insights tab. One row per round:

- Columns: drops, extensions, outstanding at round end, time called vs. actual end
- Cells with value 0 shown as "—" to reduce noise
- Visual treatment when a round had notable issues

### Screen 3 — Logs Feed

- Grouped by round with collapsible headers (top round expanded by default)
- Quick filter buttons: "This round", "Extensions", "Drops", "Penalties", "Clear"
- Each entry: colored type badge, player name, table number, round, who logged it, timestamp

### Screen 4 — Manage Tab (superadmin)

- Tournament list with source badges (PF + Carde / Carde-only), Edit/Deactivate
- User management table with role badges, Reset Password, Deactivate
- Active sessions with IP, expiry, Revoke button

---

## Deliverables I need

1. **Design token spec** — complete set of CSS custom properties: color palette (semantic + neutral scale), spacing scale (4px base), type scale (size + weight), border radius, shadow levels
2. **Component inventory** — list of every UI component needed with all states (default, hover, active, disabled, loading, error, empty)
3. **Navigation spec** — tab structure decision for mobile (bottom nav vs. top tabs), sticky header/context bar behavior, how urgency badges work on tabs
4. **Wireframes or mockups** for the 4 screens above — mobile (375px) and desktop (1280px) variants for Screen 1 and Screen 2 at minimum
5. **Future Improvements** - while this task is focused on the first re-write/productionized version for this app, I wanna keep iterating on it and need to be prepared for any future changes. Make sure to include that in your spec

---

## Additional Context

- If there are any open questions, ask them before delivering anything
- The focus should be on a non-AI-generated UI, with usable components, and a clear hierarchy between components
- Feel free to use the Figma Connector/MCP to generate these designs
- Based on the contents of this file and any other attached documents, feel free to propose any changes to the current structure and what we should be showing to the users, always focusing on ease of use, clarity of information, and being useful quickly
