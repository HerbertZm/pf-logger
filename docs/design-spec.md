# pf-logger — UI/UX Design Spec

Generated from design session · May 2026  
Figma file: https://www.figma.com/design/czEoZNIW8dHjbiea6OwlOi

---

## Design Principles

1. **Heads-up clarity** — Active round status (timer, outstanding tables, issues) readable in under 3 seconds without scrolling
2. **Mobile-first** — Portrait phone is the primary field use case; 375px is the canonical frame
3. **Urgency hierarchy** — Visual treatment distinguishes "all good" / "watch" / "urgent" without reading numbers
4. **Touch-safe** — All interactive elements minimum 44×44px
5. **Persistent context** — Tournament name and current round always visible regardless of active tab
6. **No animations on data** — Background polling cycle; no transitions on data updates

---

## Navigation Decision

| Context | Pattern | Rationale |
|---|---|---|
| Mobile (≤768px) | Bottom tab bar (72px fixed) | Thumb-reachable, native pattern, 5 tabs fit cleanly |
| Desktop (≥1024px) | Top tab bar (44px sticky) | Standard web convention, more label space |
| All viewports | Sticky context bar (56px) | Tournament + round always visible, worker status here |

### Tab structure (both viewports)
1. **Dashboard** — Active round view (default landing)
2. **Logs** — Chronological feed of all events
3. **Insights** — Cross-round summary table
4. **Data** — Raw pairings explorer (admin)
5. **Session** — PurpleFox JWT management
6. **Manage** — Tournament/user admin (superadmin only)

### Urgency badges on tabs
- **Dashboard** — urgency dot (not count) when outstanding tables exist or round is overtime
- **Logs** — numeric count of drops + extensions + penalties this round; clears on tab view
- **Session** — `!` badge when JWT expires < 30 min (amber) or is expired (red)
- **Insights, Data, Manage** — no badge

---

## Layout Anatomy

### Mobile (375px)
```
┌─────────────────────────┐  ← Context bar (56px sticky)
│ Tournament · Round #    │
├─────────────────────────┤  ← Round strip (36px, urgency-colored)
│ ROUND 5 · 50 min        │
├─────────────────────────┤
│                         │
│   HERO ZONE             │  ← Timer card (largest element on screen)
│   Timer / Stats         │
│                         │
├─────────────────────────┤
│   CONTENT ZONE          │  ← Collapsible: outstanding, extensions
│   (scrollable)          │
│                         │
│                         │
├─────────────────────────┤  ← Bottom tab bar (72px fixed)
│ ● Dash  ≡ Logs  ▦ …    │
└─────────────────────────┘
```

### Desktop (1280px)
```
┌──────────────────────────────────────────┐  ← Top bar (60px sticky)
│ pf-logger  [Tournament ▾]   Round 5   ●  │
├──────────────────────────────────────────┤  ← Tab bar (44px sticky)
│ Dashboard  Logs  Insights  Data  Manage  │
├────────┬─────────────────────┬───────────┤
│ Round  │  HERO ZONE          │ Activity  │
│ List   │  Timer + Stats      │ Feed      │
│ 220px  │  + Tables/Ext       │ 180px     │
│        │  flexible           │           │
└────────┴─────────────────────┴───────────┘
```

---

## Urgency State System

| State | Trigger | Token | Visual treatment |
|---|---|---|---|
| All Good | 0 outstanding, on time | `--color-success` | Green timer, green chip border, success glow |
| Worth Watching | 1–4 outstanding, or past timer | `--color-warning` | Amber timer, amber chip border |
| Needs Action | 5+ outstanding, or >15 min overtime | `--color-urgent` | Red timer, red border + glow, round strip flips red |

---

## Component Inventory

### Badge
States: default, disabled (0.4 opacity)  
Variants: DROP, EXT, PEN, ON TRACK, WATCH, URGENT, PF+CARDE, CARDE ONLY  
Spec: `border-radius: 9999px`, min-width 52px, height 24px, 9px Bold text  

### Button
Variants: primary (blue fill), secondary (elevated bg + border), danger (red fill), ghost (no bg), warning (amber outline)  
States: default, hover, active, disabled (0.4 opacity), loading  
Min size: `min-height: 44px`, `min-width: 120px`, `border-radius: 8px`

### Timer Display (hero)
The most prominent element on the Dashboard. Color shifts by urgency state.  
States: normal (green), warning (amber, < 5 min remaining), urgent (red, at 0), overtime (red + glow, negative time)  
Top-8 rounds: shows "Top 8 / No timer" variant — null check required  
Font: `--text-3xl` (48px Bold) for standard, `--text-hero` (80px Bold) for expanded mobile view  

### Stat Chip
4 per row on mobile, flexible on desktop  
States by urgency: urgent (red), warning (amber), muted (gray), success (green)  
Value at 0: display as "—" in muted color, not "0"

### Panel / Card
Variants: default (surface bg), elevated (shadow), urgent (red bg + glow), empty state  

### Log Entry Row
Left accent bar = type color  
Type badge: colored pill (DROP/EXT/PEN)  
Columns: type badge, player name, table + round (secondary), who logged, timestamp  

### Round Row (Cross-Round Summary)
One row per round, zero-suppression (0 → "—" in muted)  
States: normal, warning (amber bg/border), urgent (red bg/border)  
Expandable: click row → shows extension histogram + outstanding tables list  

### Filter Chip
Pill shape, `border-radius: 9999px`, 36px height  
Active: solid info fill; inactive: elevated bg + border  

### Context Bar
56px height, always sticky  
Mobile: tournament name + round + live dot  
Desktop: tournament name + round + worker status + last-updated + sync button  

### Toast / Banner
Left accent bar = severity color  
Variants: success (sync complete), warning (stale data), error (JWT expired), info (Carde-only mode)  

---

## Source-Conditional Rendering

Controlled by `TournamentContext.sources.pf` and `TournamentContext.sources.carde`.  
No scattered conditionals — one context value controls all visibility.

| Element | PF + Carde | Carde-only |
|---|---|---|
| Drops list + drop count chip | ✓ | Hidden |
| Extensions | ✓ (from PF) | ✓ (from Carde match records) |
| Judge coverage column | ✓ | Hidden |
| Judge call outcomes | ✓ | Hidden |
| Round timer + outstanding tables | ✓ | ✓ |
| Pairings / match data | ✓ | ✓ |
| Session tab / JWT badge | ✓ | Hidden |

When columns are hidden in Carde-only mode: the remaining columns expand to fill the space. No empty gaps, no broken grids.

---

## Worker / Data Freshness States

| State | UI treatment |
|---|---|
| Active, fresh data | Green dot + "Live · updated Xs ago" in context bar |
| Active, stale (>2 min) | Amber warning banner: "Stale data — last updated Xm ago" |
| Worker error | Red error banner: "Worker error — data may be stale" |
| JWT expired | Amber `!` badge on Session tab + soft warning callout on Dashboard |
| JWT expired, PF data required | Error banner with "Re-paste token in Session tab" CTA |
| No data yet (new tournament) | Empty state panels with "Waiting for first sync" message |

---

## Screen Specs

### Screen 1 — Active Round View
**Primary content (above fold, no scroll):**
- Context bar: tournament name, round number, live status
- Round strip: round number, duration, urgency color
- Timer hero card: large countdown, urgency color + glow, extends button
- Stat chips: Outstanding, w/ Extensions, Drops, Penalties

**Secondary content (collapsible, below fold):**
- Outstanding tables: numbered chips, extension marker on tables with ext
- Extensions list: table, player, duration, granted by, time

**States:** All Good, Worth Watching, Needs Action, Overtime, Top-8 (no timer)

### Screen 2 — Cross-Round Summary (Insights Tab)
**Event totals strip** at top: Total Drops, Total Extensions, Total Penalties, Rounds, Runtime

**Table columns (mobile, compact):** Rd, Drops, Ext, Outstanding, Overtime  
**Table columns (desktop, full):** Round, Status, Drops, Extensions, Outstanding, Time Called, Actual End, Overtime

**Zero-suppression:** All 0-values display as "—" in muted color  
**Row urgency:** Urgent rows get red bg + border + left accent bar  
**Expandable row (desktop):** Extension distribution mini chart + outstanding tables list  

### Screen 3 — Logs Feed
**Filter bar:** This Round, Extensions, Drops, Penalties, Clear All, Search input  
**Round groups:** Collapsible headers. Top round (current) expanded by default.  
**Round header urgency:** Active urgent rounds get red header bg  
**Log entry:** Type badge, player name, table + round, who logged, timestamp  
**Source note:** In Carde-only mode, the Drops filter chip is hidden  

### Screen 4 — Manage Tab (superadmin)
Three sections, separated by dividers:

**Tournaments:** Name, Source badge (PF+Carde / Carde Only), Status, Rounds, Created, Edit/Deactivate actions  
**User Management:** Username, Display Name, Role badge (admin/head-judge/judge), Status, Last Login, Reset PW / Deactivate  
**Active Sessions:** User, IP, Created, Expires, Revoke button  

---

## Future Improvements

### Near-term (after first production version)
- **StageTimer integration:** Import timer log exports for more accurate round start/end times. Show StageTimer vs Carde discrepancy in Insights.
- **Extension histogram:** 5-min bucket bar chart per round in the expandable row (QoL item, needs chart container component).
- **"What changed since last sync" diff banner:** Collapsible banner after worker cycle listing new drops/extensions/penalties (QoL item).
- **Multi-tournament switcher:** Dropdown in context bar to switch between simultaneous tournaments. HJ runs 2–3 at once.
- **Push notifications / sound alert:** Opt-in alert when outstanding table count crosses threshold mid-round.

### Medium-term
- **Judge coverage heatmap:** Visual map of which tables have been visited vs. uncovered, per round.
- **Player lookup:** Search by player name or user ID to see their full event history (drops, penalties, extensions).
- **Role-gated views:** HJ sees everything; Floor Judge phone view is trimmed to timer + outstanding tables only.
- **Offline resilience:** Service worker to cache last-known state; banner when network to ingestion server is lost.
- **Export:** Per-round or full-event CSV of drops/extensions/penalties for post-event reporting.

### Long-term / Architecture
- **Multi-event venue dashboard:** Single view of all simultaneous events in a venue (convention context).
- **Additional source adapters:** Melee.gg, Eventlink, other tournament software.
- **Real-time SSE push:** Replace polling with server-sent events for instant data propagation.
- **Dark/light mode toggle:** Dark is default and primary; light mode for high-daylight outdoor venues.
