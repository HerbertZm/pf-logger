# pf-logger QoL Improvement Plan

Quality-of-life improvements that do not belong in the core Phase 1–3 roadmap but meaningfully improve day-of-event operator experience. Each numbered section is designed to be completable in one focused session (1–3 hrs) and is independent of all others unless noted.

**Dependency note:** QoL 2, 4, and 10 should be implemented after QoL 1, as they rely on the logistics-filtered extension arrays. All other items are standalone.

---

## QoL 1 — Extension Logistics Filtering

**Goal:** Ignore anomalous time extensions from all Insights metrics. A 55-minute extension is not a judge response — it is the TO pausing the clock for lunch, a late start, or an early-round adjustment. Mixing these into averages and summaries obscures the real data.

### 1.1 Frontend constant

Add near the top of the `<script>` block in `index.html`, next to other global state/config:

```javascript
const EXTENSION_LOGISTICS_THRESHOLD_MIN = 50;
```

This constant does not filter data server-side. The DB stores all raw extension values. Filtering is applied only during rendering, keeping the raw data intact for audit purposes via the Data tab.

### 1.2 Tag logistics extensions in `groupExtsByRound()`

`groupExtsByRound()` currently returns all time-log entries. Modify it to tag logistics extensions rather than drop them, so callers can choose to exclude or display them separately:

```javascript
function groupExtsByRound() {
  const rounds = {};
  for (const log of (rawData.time_logs || [])) {
    if (!log.round || !log.action) continue;
    const match = /(\d+)\s*min/.exec(log.action);
    const toMin = match ? +match[1] : 0;
    const isLogistics = toMin > EXTENSION_LOGISTICS_THRESHOLD_MIN;
    // ... existing parse logic ...
    entry.isLogistics = isLogistics;  // add this flag to each entry object
    // insert into rounds as before
  }
  return rounds;
}
```

### 1.3 Split arrays in `renderRoundBlock()`

In `renderRoundBlock()`, split `extSummaries` into two arrays before computing stats:

```javascript
const operationalExts = extSummaries.filter(e => !e.isLogistics);
const logisticsExts   = extSummaries.filter(e =>  e.isLogistics);

const totalExt   = operationalExts.length;
const multiCount = operationalExts.filter(e => e.isMulti).length;
const longest    = operationalExts[0]; // operationalExts is already sorted desc
```

Pass `logisticsExts.length` into `renderExtSection()` as a second argument so it can render the filtered count note.

### 1.4 Filtered count note in `renderExtSection()`

After the main extension table, append a dimmed note when logistics extensions exist:

```javascript
function renderExtSection(exts, playerMap, logisticsCount = 0) {
  // ... existing table HTML ...
  const note = logisticsCount > 0
    ? `<div class="ext-logistics-note">
         ${logisticsCount} extension${logisticsCount !== 1 ? 's' : ''}
         &gt; ${EXTENSION_LOGISTICS_THRESHOLD_MIN} min excluded from averages (logistics)
       </div>`
    : '';
  return tableHtml + note;
}
```

CSS:

```css
.ext-logistics-note {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
  padding: 6px 12px 10px;
  letter-spacing: .04em;
  border-top: 1px solid var(--border);
}
```

### 1.5 Apply in `renderInsights()` aggregate averages

The tournament-level summary panel computes aggregate extension counts. Apply the same filter:

```javascript
const operationalExtCounts = allRounds.map(r => {
  const exts = extData[r] || {};
  return Object.values(exts).filter(steps =>
    steps.every(s => s.to <= EXTENSION_LOGISTICS_THRESHOLD_MIN)
  ).length;
});
```

### 1.6 Verification checklist

- [ ] Extension of 55 min does not appear in `totalExt` or `longest` stat cards
- [ ] Extension of 55 min appears in the "N extensions > 50 min excluded" note below the table
- [ ] Extension of exactly 50 min is treated as operational (threshold is exclusive: `> 50`)
- [ ] Changing `EXTENSION_LOGISTICS_THRESHOLD_MIN` at the top of the script immediately affects all rendered data on next `renderInsights()` call
- [ ] Raw extension value is still visible in Data tab → `time_logs` table (no server-side filtering)

---

## QoL 2 — Round-Over-Round Comparison

**Goal:** Side-by-side stat view for any two rounds in the Insights tab. Lets the head judge immediately answer "was Round 5 worse than Round 4 for slow play?" Requires QoL 1.

### 2.1 HTML — comparison panel in Insights tab

Add a panel at the top of `#insights-content`, rendered by `renderInsights()` when more than one round is available:

```html
<div class="panel" id="round-compare-panel" style="margin-bottom:20px">
  <div class="panel-title">Round comparison</div>
  <div class="row" style="margin-bottom:14px;gap:12px;align-items:flex-end">
    <div class="field" style="flex:0 0 auto">
      <label>Round A</label>
      <select id="compareRoundA" onchange="renderRoundComparison()"></select>
    </div>
    <div class="field" style="flex:0 0 auto">
      <label>Round B</label>
      <select id="compareRoundB" onchange="renderRoundComparison()"></select>
    </div>
  </div>
  <div id="round-compare-body"></div>
</div>
```

### 2.2 New function `renderRoundComparison()`

Add after `renderInsights()`:

```javascript
function renderRoundComparison() {
  const body = document.getElementById('round-compare-body');
  if (!body) return;
  const rA = +document.getElementById('compareRoundA').value;
  const rB = +document.getElementById('compareRoundB').value;
  if (!rA || !rB || rA === rB) {
    body.innerHTML = '<div class="empty-section" style="padding:16px">Select two different rounds to compare.</div>';
    return;
  }

  const extData = groupExtsByRound();
  const penData = groupPensByRound();
  const timerMap = {};
  for (const t of (rawData.round_timers || [])) timerMap[t.round] = t;

  function roundStats(r) {
    const exts = extData[r] || {};
    const opExts = Object.values(exts).filter(steps =>
      steps.every(s => s.to <= EXTENSION_LOGISTICS_THRESHOLD_MIN)
    );
    const pens = penData[r] || {};
    const totalPen = Object.values(pens).reduce((s, c) => s + c, 0);
    const ti = timerMap[r] || {};
    let durationMin = null;
    if (ti.started_at && ti.completed_at) {
      durationMin = Math.round((new Date(ti.completed_at) - new Date(ti.started_at)) / 60000);
    }
    const drops = (rawData.drops || []).filter(d => d.round === r && !d.is_cancelled).length;
    const incomplete = ti.incomplete_at_end ?? null;
    return { exts: opExts.length, pens: totalPen, durationMin, drops, incomplete };
  }

  const sA = roundStats(rA);
  const sB = roundStats(rB);

  function deltaHtml(vA, vB, unit, lowerIsBetter) {
    if (vA == null || vB == null) return '<span style="color:var(--muted)">—</span>';
    const d = vB - vA;
    if (d === 0) return '<span style="color:var(--muted)">±0</span>';
    const better = lowerIsBetter ? d < 0 : d > 0;
    const color = better ? 'var(--judge)' : 'var(--drop)';
    const arrow = d > 0 ? '▲' : '▼';
    return `<span style="color:${color}">${arrow} ${Math.abs(d)}${unit}</span>`;
  }

  const rows = [
    ['Extensions',        sA.exts,        sB.exts,        '',    true],
    ['Drops',             sA.drops,       sB.drops,       '',    true],
    ['Penalties',         sA.pens,        sB.pens,        '',    true],
    ['Incomplete tables', sA.incomplete,  sB.incomplete,  '',    true],
    ['Round duration',    sA.durationMin, sB.durationMin, 'min', true],
  ];

  let html = `<div class="compare-grid">
    <div class="compare-header"></div>
    <div class="compare-header">Round ${rA}</div>
    <div class="compare-header">Round ${rB}</div>
    <div class="compare-header">Δ (B vs A)</div>`;

  for (const [label, vA, vB, unit, lowerBetter] of rows) {
    const fmt = v => v == null ? '—' : `${v}${unit}`;
    html += `
    <div class="compare-label">${label}</div>
    <div class="compare-val">${fmt(vA)}</div>
    <div class="compare-val">${fmt(vB)}</div>
    <div class="compare-delta">${deltaHtml(vA, vB, unit, lowerBetter)}</div>`;
  }
  html += '</div>';
  body.innerHTML = html;
}
```

### 2.3 Populate dropdowns in `renderInsights()`

At the end of `renderInsights()`, populate dropdowns and trigger initial render:

```javascript
function _populateCompareDropdowns(rounds) {
  ['compareRoundA', 'compareRoundB'].forEach((id, idx) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = +sel.value;
    sel.innerHTML = rounds.map(r =>
      `<option value="${r}"${r === (prev || rounds[idx]) ? ' selected' : ''}>Round ${r}</option>`
    ).join('');
  });
  renderRoundComparison();
}
// Call at end of renderInsights():
_populateCompareDropdowns(allRounds);
```

Default: dropdown A = most recent round, dropdown B = second-most-recent round.

### 2.4 CSS

```css
.compare-grid {
  display: grid;
  grid-template-columns: 1fr 100px 100px 120px;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  font-family: var(--mono);
  font-size: 12px;
}
.compare-header {
  background: var(--surface2);
  color: var(--muted);
  font-size: 10px;
  letter-spacing: .1em;
  text-transform: uppercase;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.compare-label {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(46,46,56,.5);
  color: var(--muted);
}
.compare-val, .compare-delta {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(46,46,56,.5);
  border-left: 1px solid var(--border);
  text-align: right;
}
.compare-delta { font-weight: 500; }
```

### 2.5 Verification checklist

- [ ] Dropdown A defaults to the most recent round, dropdown B to the second-most-recent
- [ ] Selecting the same round in both shows "Select two different rounds to compare"
- [ ] Drops Δ shows `▼` in green when Round B has fewer drops than Round A
- [ ] Duration shows `—` for rounds where `started_at` or `completed_at` is NULL
- [ ] Comparison re-renders without a full page refresh when either dropdown changes
- [ ] Logistics extensions (> 50 min) are excluded from the Extension count in both columns

---

## QoL 3 — Round Pace Indicator

**Goal:** Surface an "on track / behind / ahead" badge on each active round block in Insights, calculated from actual elapsed time versus the scheduled timer end. Also triggers a red alert banner when a round is significantly overdue.

### 3.1 New function `_roundPaceLabel(timerInfo)`

```javascript
function _roundPaceLabel(timerInfo) {
  if (!timerInfo.timer_end_datetime || !timerInfo.started_at) return null;
  if (timerInfo.carde_status === 'COMPLETE' || timerInfo.completed_at) return null;
  const now = new Date();
  const end = new Date(timerInfo.timer_end_datetime);
  const diffMin = Math.round((now - end) / 60000);
  if (diffMin > 15) return { label: 'significantly over', cls: 'pace-over-alert', diffMin };
  if (diffMin > 0)  return { label: `${diffMin}m over`,   cls: 'pace-behind',     diffMin };
  if (diffMin < -5) return { label: `${Math.abs(diffMin)}m remaining`, cls: 'pace-ahead', diffMin };
  return { label: 'on track', cls: 'pace-ok', diffMin };
}
```

### 3.2 Render badge and alert banner in `renderRoundBlock()`

```javascript
const pace = _roundPaceLabel(timerInfo);
const paceBadge = pace
  ? `<span class="pace-badge ${pace.cls}">${pace.label}</span>`
  : '';

// Inject paceBadge into section-title div, after the existing badge-result span

const paceAlertBanner = (pace && pace.diffMin > 15)
  ? `<div class="pace-alert-banner">
       Round ${round} is ${pace.diffMin} minutes past time called with no result recorded.
       Check on outstanding tables.
     </div>`
  : '';

// Inject paceAlertBanner at the top of section-body, before other content
```

### 3.3 CSS

```css
.pace-badge {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: .08em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 3px;
  font-weight: 500;
}
.pace-ok         { background: rgba(106,247,180,.1); color: var(--judge);        border: 1px solid rgba(106,247,180,.2); }
.pace-ahead      { background: rgba(124,106,247,.1); color: var(--accent-bright);border: 1px solid rgba(124,106,247,.2); }
.pace-behind     { background: rgba(247,192,106,.1); color: var(--penalty);      border: 1px solid rgba(247,192,106,.2); }
.pace-over-alert { background: rgba(247,106,106,.1); color: var(--drop);         border: 1px solid rgba(247,106,106,.3); }

.pace-alert-banner {
  background: rgba(247,106,106,.08);
  border: 1px solid rgba(247,106,106,.25);
  border-radius: 6px;
  padding: 10px 14px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--drop);
  margin-bottom: 14px;
}
```

### 3.4 Verification checklist

- [ ] Badge shows "on track" in green for a round within 5 minutes of its timer end
- [ ] Badge shows "Xm over" in amber for a round 1–15 minutes past timer end
- [ ] Badge shows "significantly over" in red + alert banner for rounds > 15 min past timer end
- [ ] No badge appears for completed rounds (`carde_status === 'COMPLETE'` or `completed_at` set)
- [ ] No badge appears for rounds without `timer_end_datetime` (top-8 bracket rounds)
- [ ] Badge updates correctly on each auto-refresh cycle (re-computed on each `renderInsights()` call)

---

## QoL 4 — Extension Distribution Histogram

**Goal:** A small bar chart inside each round block showing the distribution of extension lengths bucketed in 5-minute increments. Helps spot outlier tables that consistently need more time. Requires QoL 1.

### 4.1 New function `renderExtHistogram(extSummaries)`

```javascript
function renderExtHistogram(extSummaries) {
  if (extSummaries.length < 2) return '';
  const BUCKET = 5;
  const buckets = {};
  for (const e of extSummaries) {
    const b = Math.ceil((e.finalTo || 0) / BUCKET) * BUCKET;
    buckets[b] = (buckets[b] || 0) + 1;
  }
  const keys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  const maxCount = Math.max(...Object.values(buckets));

  const bars = keys.map(k => {
    const count = buckets[k];
    const pct = Math.round((count / maxCount) * 100);
    return `<div class="ext-hist-col">
      <div class="ext-hist-bar-wrap">
        <div class="ext-hist-bar" style="height:${pct}%"></div>
      </div>
      <div class="ext-hist-label">${k}m</div>
      <div class="ext-hist-count">${count}</div>
    </div>`;
  }).join('');

  return `<div style="margin-bottom:20px">
    <div class="panel-title" style="margin-bottom:10px">Extension distribution</div>
    <div class="ext-hist">${bars}</div>
  </div>`;
}
```

Call in `renderRoundBlock()` after `renderExtSection(operationalExts, playerMap, logisticsExts.length)`:

```javascript
${renderExtHistogram(operationalExts)}
```

### 4.2 CSS

```css
.ext-hist {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 80px;
}
.ext-hist-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 32px;
  max-width: 56px;
}
.ext-hist-bar-wrap {
  width: 100%;
  height: 56px;
  display: flex;
  align-items: flex-end;
}
.ext-hist-bar {
  width: 100%;
  background: var(--result);
  border-radius: 3px 3px 0 0;
  opacity: .7;
  transition: opacity .15s;
  min-height: 2px;
}
.ext-hist-bar:hover { opacity: 1; }
.ext-hist-label {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--muted);
  margin-top: 4px;
}
.ext-hist-count {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text);
}
```

### 4.3 Verification checklist

- [ ] Histogram does not render for rounds with 0 or 1 extensions
- [ ] Tallest bar always reaches 100% height; shorter bars scale proportionally
- [ ] Logistics extensions (> 50 min) are excluded from histogram data
- [ ] A 5-minute extension and a 10-minute extension produce two distinct bars
- [ ] Bars respect the existing dark theme (`--result` for bars, `--muted` for labels)

---

## QoL 5 — "New Since Last Sync" Tab Badge

**Goal:** After each successful live sync, show a count badge on the Logs tab button indicating how many entries are new. Clears when the user switches to the Logs tab.

### 5.1 Module-level state and `_updateLogsBadge()`

```javascript
let _newSinceLastSync = 0;

function _updateLogsBadge() {
  const btn = document.querySelector('.tab[onclick*="switchTab(\'logs\')"]');
  if (!btn) return;
  let badge = btn.querySelector('.tab-new-badge');
  if (_newSinceLastSync > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-new-badge tab-badge';
      btn.appendChild(badge);
    }
    badge.textContent = _newSinceLastSync;
  } else {
    if (badge) badge.remove();
  }
}
```

### 5.2 Set count in `fetchAll()`

After the `seenHashes` diff logic that identifies `newEntries`:

```javascript
_newSinceLastSync = newEntries.length;
_updateLogsBadge();
```

### 5.3 Clear badge in `switchTab()`

```javascript
if (name === 'logs') {
  _newSinceLastSync = 0;
  _updateLogsBadge();
}
```

### 5.4 Note on CSS

The existing `.tab-badge` class already provides the red pill style used by the Infractions tab badge. `tab-new-badge` inherits from it — no new CSS required.

### 5.5 Verification checklist

- [ ] After a sync with 3 new drops: Logs tab shows a red `3` badge
- [ ] Switching to the Logs tab removes the badge immediately
- [ ] Syncing when no new entries are found shows no badge (or removes an existing one)
- [ ] Badge correctly shows `0` state (no badge rendered) after `clearSeen()` is called and re-synced with no new items

---

## QoL 6 — Operator Notes Per Round

**Goal:** Let the head judge attach a short freeform note to any round (e.g., "deck check pile-up at tables 12–15"). Notes live only in the local SQLite DB — never synced to PurpleFox. Visible in Insights; editable inline by admin-role users.

### 6.1 DB migration in `db_init()` (`serve.py`)

Add to the migration block in `db_init()`, using the same `PRAGMA table_info()` guard pattern used elsewhere:

```python
cols = [r[1] for r in conn.execute("PRAGMA table_info(round_timers)").fetchall()]
if "operator_notes" not in cols:
    conn.execute("ALTER TABLE round_timers ADD COLUMN operator_notes TEXT")
```

The `CREATE TABLE IF NOT EXISTS round_timers` statement does not need updating — the migration handles existing DBs, and `SELECT *` already picks up new columns automatically.

### 6.2 New API endpoint

Add to `serve.py` route dispatch in `do_POST` (or `do_PATCH` if the server supports it):

```
PATCH /api/round-notes?tournamentId=<tid>&round=<n>
  Body:    {"notes": "text, max 500 chars"}
  Auth:    Bearer — admin role required
  Returns: {"ok": true}
```

Handler:

```python
def _handle_round_notes_patch(self):
    username = self._require_admin()
    if username is None:
        return
    qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
    tid = qs.get('tournamentId', [''])[0]
    round_num = int(qs.get('round', ['0'])[0] or 0)
    body = json.loads(self._read_body())
    notes = (body.get('notes') or '')[:500]
    with db_connect() as conn:
        conn.execute(
            "UPDATE round_timers SET operator_notes = ? WHERE tournament_id = ? AND round = ?",
            (notes or None, tid, round_num)
        )
    self._json({'ok': True})
```

Include `operator_notes` in `/api/logs` response automatically — `db_read_round_timers()` uses `SELECT *` so no change is needed there.

### 6.3 Frontend — display in `renderRoundBlock()`

Add a notes section at the bottom of each round's `.section-body`:

```javascript
const notes = timerInfo.operator_notes || '';
const notesHtml = `
  <div class="round-notes-block">
    <div class="panel-title" style="margin-bottom:6px">Operator notes</div>
    ${notes
      ? `<div class="round-notes-text" data-notes="${escHtml(notes)}">${escHtml(notes)}</div>`
      : `<div class="round-notes-text round-notes-empty" data-notes="">No notes for this round.</div>`
    }
    ${_isAdmin
      ? `<button class="btn btn-sm" style="margin-top:8px"
           onclick="editRoundNote(${round}, this)">Edit note</button>`
      : ''
    }
  </div>`;
```

### 6.4 New function `editRoundNote(round, btn)`

```javascript
async function editRoundNote(round, btn) {
  const block = btn.closest('.round-notes-block');
  const textEl = block.querySelector('.round-notes-text');
  const existing = textEl.dataset.notes || '';
  const input = document.createElement('textarea');
  input.className = 'round-notes-input';
  input.value = existing;
  input.maxLength = 500;
  input.placeholder = 'e.g. "Deck check pile-up at tables 12–15"';
  textEl.replaceWith(input);
  btn.textContent = 'Save';
  btn.onclick = async () => {
    const notes = input.value.trim();
    const tid = getTid();
    await apiFetch(`/api/round-notes?tournamentId=${encodeURIComponent(tid)}&round=${round}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ notes }),
    });
    // Patch in-memory so re-renders reflect the change without a full sync
    const t = (rawData.round_timers || []).find(t => t.round === round);
    if (t) t.operator_notes = notes || null;
    renderInsights();
  };
}
```

### 6.5 CSS

```css
.round-notes-block {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.round-notes-text {
  font-family: var(--sans);
  font-size: 13px;
  color: var(--text);
  line-height: 1.6;
  white-space: pre-wrap;
}
.round-notes-empty { color: var(--muted); font-style: italic; }
.round-notes-input {
  width: 100%;
  font-family: var(--sans);
  font-size: 13px;
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--text);
  padding: 8px 10px;
  resize: vertical;
  min-height: 60px;
  outline: none;
  box-sizing: border-box;
}
```

### 6.6 Update `agent/AGENT_CONTEXT.md` after implementation

Add to the API routes table: `PATCH /api/round-notes` — admin — saves operator note for a round.
Add to the DB schema section: `round_timers.operator_notes TEXT` — freeform operator annotation, local only.

### 6.7 Verification checklist

- [ ] Rounds without notes show "No notes for this round." in muted italic
- [ ] Admin users see an "Edit note" button; non-admin users do not
- [ ] Saving a note persists across page refresh (stored in `round_timers.operator_notes`)
- [ ] Note text is HTML-escaped in the display view via `escHtml()` (no XSS)
- [ ] Notes longer than 500 characters are silently truncated server-side
- [ ] `PATCH /api/round-notes` returns 403 for non-admin users
- [ ] Note appears in the Copy Round Summary output (QoL 9) if that item is also implemented

---

## QoL 7 — Collapsible Round Blocks in Logs Tab

**Goal:** Group the Logs tab feed by round with collapsible headers. Default: current (highest-numbered) round expanded, all past rounds collapsed. Open/collapsed state persists through auto-refresh cycles.

### 7.1 Current state

`renderAll()` renders a flat `#logSections` container. The `.section` / `.section-header` / `.section-body` collapsible pattern already exists in the CSS and is used by the Insights tab — this item ports it to the Logs tab.

### 7.2 Change to `renderAll()`

Capture open state before re-rendering and restore it after:

```javascript
function renderAll() {
  // Capture which rounds are currently open
  const openSet = new Set();
  document.querySelectorAll('#logSections .section[data-round]').forEach(s => {
    if (s.classList.contains('open')) openSet.add(+s.dataset.round);
  });
  const isFirstRender = openSet.size === 0;

  const filtered = getFiltered();
  const rounds = [...new Set(filtered.map(e => e.round).filter(Boolean))].sort((a, b) => b - a);
  const maxRound = rounds[0] || null;

  let html = '';
  for (const round of rounds) {
    const entries = filtered.filter(e => e.round === round);
    const isOpen = isFirstRender ? round === maxRound : openSet.has(round);
    html += renderLogsRoundSection(round, entries, isOpen);
  }
  document.getElementById('logSections').innerHTML = html;
}
```

### 7.3 New function `renderLogsRoundSection(round, entries, isOpen)`

```javascript
function renderLogsRoundSection(round, entries, isOpen) {
  const count = entries.length;
  const newCount = entries.filter(e => !seenHashes.has(e.hash)).length;
  const newBadge = newCount > 0
    ? `<span class="new-badge">${newCount} new</span>`
    : '';
  return `
    <div class="section ${isOpen ? 'open' : ''}" data-round="${round}" style="margin-bottom:10px">
      <div class="section-header" onclick="this.closest('.section').classList.toggle('open')">
        <div class="section-title">
          <span class="type-badge badge-result">Round ${round}</span>
          <span style="color:var(--muted);font-size:11px;font-family:var(--mono)">${count} entries</span>
          ${newBadge}
        </div>
        <div class="section-right"><span class="chevron">▾</span></div>
      </div>
      <div class="section-body">
        ${renderLogsTable(entries)}
      </div>
    </div>`;
}
```

### 7.4 Verification checklist

- [ ] On first load: only the highest round is expanded; all others are collapsed
- [ ] Clicking a round header toggles its open state without re-rendering other rounds
- [ ] After `fetchAll()` auto-refresh, the open/collapsed state of rounds the user toggled is preserved
- [ ] A round with new entries since last clear shows a green "N new" badge
- [ ] Rounds with 0 entries matching the current filter are still listed (collapsed)

---

## QoL 8 — Quick Filter Presets

**Goal:** One-click buttons applying common filter combinations, replacing manual dropdown adjustment for the most frequent judge workflows.

### 8.1 HTML — preset button row

Add below `.filter-bar` in the Logs tab, shown only when data is loaded (same condition as `#filterBar`):

```html
<div class="filter-presets" id="filterPresets" style="display:none">
  <span class="filter-preset-label">Quick filters</span>
  <button class="btn btn-sm filter-preset" onclick="applyPreset('thisRound', event)">This round</button>
  <button class="btn btn-sm filter-preset" onclick="applyPreset('extensions', event)">Extensions only</button>
  <button class="btn btn-sm filter-preset" onclick="applyPreset('drops', event)">Drops only</button>
  <button class="btn btn-sm filter-preset" onclick="applyPreset('penalties', event)">Penalties only</button>
  <button class="btn btn-sm filter-preset" onclick="applyPreset('clear', event)">Clear</button>
</div>
```

Show `#filterPresets` wherever `#filterBar` is shown (in `renderAll()` / data loaded state).

### 8.2 New function `applyPreset(name, e)`

```javascript
function applyPreset(name, e) {
  const roundSel = document.getElementById('roundFilter');
  const typeSel  = document.getElementById('typeFilter');

  document.querySelectorAll('.filter-preset').forEach(b => b.classList.remove('active'));

  switch (name) {
    case 'thisRound': {
      const rounds = [...new Set(
        (rawData.drops || []).map(d => d.round)
          .concat((rawData.time_logs || []).map(t => t.round))
          .filter(Boolean)
      )].sort((a, b) => b - a);
      roundSel.value = rounds[0] || 'all';
      typeSel.value = 'all';
      break;
    }
    case 'extensions': typeSel.value = 'time_ext'; break;
    case 'drops':      typeSel.value = 'drop';     break;
    case 'penalties':  typeSel.value = 'penalty';  break;
    case 'clear':
      roundSel.value = 'all';
      typeSel.value = 'all';
      document.getElementById('searchFilter').value = '';
      break;
  }

  if (name !== 'clear' && e) e.target.classList.add('active');
  renderAll();
}
```

### 8.3 CSS

```css
.filter-presets {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.filter-preset-label {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted);
}
.filter-preset.active {
  border-color: var(--accent);
  color: var(--accent-bright);
  background: rgba(124,106,247,.12);
}
```

### 8.4 Verification checklist

- [ ] "This round" sets the round filter to the highest-numbered round with data
- [ ] "Drops only" sets type filter to drop without changing the round filter
- [ ] "Clear" resets all three filters (type, round, search text)
- [ ] The active preset button gets a highlighted border; clicking "Clear" removes all highlights
- [ ] Preset row is hidden when no data is loaded

---

## QoL 9 — Copy-to-Clipboard Round Summary

**Goal:** One-click button producing a paste-ready plain-text summary of a round, suitable for posting in Discord or Slack.

### 9.1 Button in `renderRoundBlock()`

Add to the `.section-right` div in each round's header:

```javascript
`<button class="btn btn-sm" onclick="copyRoundSummary(${round}, event)" title="Copy summary to clipboard">Copy</button>`
```

### 9.2 New function `copyRoundSummary(round, e)`

```javascript
function copyRoundSummary(round, e) {
  e.stopPropagation(); // prevent toggling the section open/closed

  const extData  = groupExtsByRound();
  const penData  = groupPensByRound();
  const timerMap = {};
  for (const t of (rawData.round_timers || [])) timerMap[t.round] = t;
  const ti = timerMap[round] || {};

  const fmtTime = iso => iso
    ? new Date(iso).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
    : '—';

  const exts = extData[round] || {};
  const opExtCount = Object.values(exts).filter(steps =>
    steps.every(s => s.to <= EXTENSION_LOGISTICS_THRESHOLD_MIN)
  ).length;

  const pens = penData[round] || {};
  const totalPen = Object.values(pens).reduce((s, c) => s + c, 0);
  const penDetail = totalPen
    ? ' (' + Object.entries(pens).map(([t, c]) => `${c}× ${t}`).join(', ') + ')'
    : '';

  const drops = (rawData.drops || []).filter(d => d.round === round && !d.is_cancelled).length;
  const tName = (tournamentInfo && tournamentInfo.name) ? `[${tournamentInfo.name}] ` : '';

  const lines = [
    `${tName}Round ${round} Summary`,
    `Timer: ${fmtTime(ti.started_at)} → ${fmtTime(ti.timer_end_datetime)}${ti.completed_at ? ` → completed ${fmtTime(ti.completed_at)}` : ''}`,
    `Drops: ${drops}`,
    `Extensions: ${opExtCount}${ti.incomplete_at_end != null ? ` | Outstanding at end: ${ti.incomplete_at_end}` : ''}`,
    `Penalties: ${totalPen}${penDetail}`,
  ];

  if (ti.operator_notes) lines.push(`Notes: ${ti.operator_notes}`);

  const text = lines.join('\n');
  const btn = e.target;

  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1500);
  }).catch(() => {
    alert('Clipboard not available. Copy manually:\n\n' + text);
  });
}
```

### 9.3 Verification checklist

- [ ] Clicking "Copy" does not toggle the round section open/closed
- [ ] Output includes tournament name, round number, timer range, drops, extensions, penalties
- [ ] Operator notes are included in the output if set for that round (requires QoL 6)
- [ ] Logistics extensions (> 50 min) are excluded from the extension count in the summary
- [ ] Button shows "Copied!" for 1.5 s then reverts to "Copy"
- [ ] On non-HTTPS (no `navigator.clipboard`): falls back to `alert()` with the text

---

## QoL 10 — Trend View (All-Rounds Overview Table)

**Goal:** A compact table at the top of the Insights tab showing drops, extensions, penalties, outstanding tables, and round duration for every round in one glance — the longitudinal view operators need to spot improving or worsening trends across the day. Requires QoL 1.

### 10.1 New function `renderTrendTable(...)`

```javascript
function renderTrendTable(allRounds, extData, penData, timerMap, dropsByRound) {
  if (allRounds.length < 2) return '';
  const rows = [...allRounds].sort((a, b) => a - b).map(r => {
    const ti = timerMap[r] || {};
    let durStr = '—';
    if (ti.started_at && ti.completed_at) {
      durStr = Math.round((new Date(ti.completed_at) - new Date(ti.started_at)) / 60000) + 'm';
    }
    const exts = Object.values(extData[r] || {}).filter(steps =>
      steps.every(s => s.to <= EXTENSION_LOGISTICS_THRESHOLD_MIN)
    ).length;
    const pens = Object.values(penData[r] || {}).reduce((s, c) => s + c, 0);
    const drops = dropsByRound[r] || 0;
    const outstanding = ti.incomplete_at_end;
    return `<tr>
      <td class="hash-cell">R${r}</td>
      <td class="trend-val">${drops || '—'}</td>
      <td class="trend-val">${exts || '—'}</td>
      <td class="trend-val">${pens || '—'}</td>
      <td class="trend-val">${outstanding != null ? outstanding : '—'}</td>
      <td class="trend-val" style="color:var(--muted)">${durStr}</td>
    </tr>`;
  }).join('');

  return `<div class="panel" style="margin-bottom:20px;padding:0;overflow:hidden">
    <div style="padding:10px 16px;background:var(--surface2);border-bottom:1px solid var(--border)">
      <span class="panel-title" style="margin:0">All-rounds overview</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Round</th><th>Drops</th><th>Extensions</th>
          <th>Penalties</th><th>Outstanding</th><th>Duration</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
```

Call in `renderInsights()` after the tournament header panel and before the per-round blocks:

```javascript
const dropsByRound = {};
for (const d of (rawData.drops || [])) {
  if (d.is_cancelled) continue;
  dropsByRound[d.round] = (dropsByRound[d.round] || 0) + 1;
}
html += renderTrendTable(allRounds, extData, penData, timerMap, dropsByRound);
```

### 10.2 CSS

```css
.trend-val {
  font-family: var(--mono);
  font-size: 12px;
  text-align: right;
  padding: 6px 12px;
}
```

### 10.3 Verification checklist

- [ ] Table does not render when fewer than 2 rounds of data are available
- [ ] Rounds appear in ascending order (Round 1 first)
- [ ] Cells with value `0` render as `—` to reduce visual noise
- [ ] Duration column shows `—` for rounds without `started_at` or `completed_at`
- [ ] Logistics extensions are excluded from the Extensions column count
- [ ] Table respects the dark theme colors of other data tables in the app

---

## QoL 11 — Keyboard Shortcuts

**Goal:** Keyboard navigation for power users: tab switching, sync trigger, modal dismissal, and search focus. Zero JS library dependencies. Keys `1`–`8` and `F` are suppressed when focus is in an `<input>`, `<textarea>`, or `<select>`.

### 11.1 Shortcut map

| Key | Action |
|-----|--------|
| `1` | Switch to Logs tab |
| `2` | Switch to Insights tab |
| `3` | Switch to Infractions tab |
| `4` | Switch to Session tab |
| `5` | Switch to Debug tab |
| `6` | Switch to Guide tab |
| `7` | Switch to Schema tab |
| `8` | Switch to Data tab |
| `Ctrl+Enter` | Trigger `fetchAll()` |
| `Esc` | Blur focused input; does not close login modal |
| `F` | Focus `#searchFilter` and switch to Logs tab |

### 11.2 Implementation

Add near the end of the `<script>` block, before `checkAuth()`:

```javascript
const _TAB_KEYS = ['logs', 'insights', 'infractions', 'session', 'debug', 'guide', 'schema', 'data'];

document.addEventListener('keydown', function(e) {
  const active = document.activeElement;
  const isTyping = active && (
    active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT'
  );

  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    fetchAll();
    return;
  }

  if (e.key === 'Escape') {
    if (active) active.blur();
    return;
  }

  if (isTyping) return;

  const idx = parseInt(e.key, 10);
  if (idx >= 1 && idx <= 8) {
    e.preventDefault();
    switchTab(_TAB_KEYS[idx - 1]);
    return;
  }

  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    switchTab('logs');
    const sf = document.getElementById('searchFilter');
    if (sf) sf.focus();
  }
});
```

### 11.3 Shortcut reference in Guide tab

Add a table to the Guide tab quick-reference section:

```html
<div class="panel" style="margin-bottom:16px">
  <div class="panel-title">Keyboard shortcuts</div>
  <table>
    <thead><tr><th>Key</th><th>Action</th></tr></thead>
    <tbody>
      <tr><td class="hash-cell">1 – 8</td><td>Switch tab (Logs, Insights, Infractions, Session, Debug, Guide, Schema, Data)</td></tr>
      <tr><td class="hash-cell">Ctrl+Enter</td><td>Fetch / sync data</td></tr>
      <tr><td class="hash-cell">Esc</td><td>Blur focused input</td></tr>
      <tr><td class="hash-cell">F</td><td>Focus search filter (switches to Logs tab first)</td></tr>
    </tbody>
  </table>
</div>
```

### 11.4 Verification checklist

- [ ] Pressing `2` switches to the Insights tab; pressing `1` returns to Logs
- [ ] Pressing `2` while typing in the search box does not switch tabs
- [ ] `Ctrl+Enter` triggers a sync regardless of current tab
- [ ] `F` focuses the search input and switches to Logs if on another tab
- [ ] `Esc` blurs focused inputs; does not close the login modal
- [ ] Key `8` is a no-op when the Data tab is hidden for non-admin users

---

## QoL 12 — Filter and Sort State Persistence

**Goal:** Preserve the round filter, type filter, search text, highlight-new toggle, and refresh interval across tab switches and page refreshes using `localStorage`. Operators should not lose their view state mid-event.

### 12.1 Controls to persist

| Control ID | `localStorage` key | Default |
|------------|-------------------|---------|
| `roundFilter` | `pf_filter_round` | `'all'` |
| `typeFilter` | `pf_filter_type` | `'all'` |
| `searchFilter` | `pf_filter_search` | `''` |
| `highlightNew` | `pf_filter_hl_new` | `'1'` |
| `refreshInterval` | `pf_refresh_interval` | `'30'` |

Key prefix `pf_` matches the existing `pf_auth_token` and `pf_seen_hashes_v3` keys.

### 12.2 Save helper

```javascript
function _saveFilterState() {
  try {
    localStorage.setItem('pf_filter_round',     document.getElementById('roundFilter').value);
    localStorage.setItem('pf_filter_type',      document.getElementById('typeFilter').value);
    localStorage.setItem('pf_filter_search',    document.getElementById('searchFilter').value);
    localStorage.setItem('pf_filter_hl_new',    document.getElementById('highlightNew').checked ? '1' : '0');
    localStorage.setItem('pf_refresh_interval', document.getElementById('refreshInterval').value);
  } catch {}
}
```

Add `_saveFilterState()` to the `onchange`/`oninput` handlers for each control.

### 12.3 Restore on page load

```javascript
function _restoreFilterState() {
  try {
    const round    = localStorage.getItem('pf_filter_round');
    const type     = localStorage.getItem('pf_filter_type');
    const search   = localStorage.getItem('pf_filter_search');
    const hlNew    = localStorage.getItem('pf_filter_hl_new');
    const interval = localStorage.getItem('pf_refresh_interval');

    if (round)        document.getElementById('roundFilter').value      = round;
    if (type)         document.getElementById('typeFilter').value       = type;
    if (search)       document.getElementById('searchFilter').value     = search;
    if (hlNew !== null) document.getElementById('highlightNew').checked = hlNew === '1';
    if (interval)     document.getElementById('refreshInterval').value  = interval;
  } catch {}
}
```

Call `_restoreFilterState()` during the init chain after `checkAuth()` and before `loadTournaments()`.

### 12.4 Round filter caveat

`populateRoundFilter()` rebuilds `<select>` options from current data. After repopulation, restore the saved value if it still exists:

```javascript
function populateRoundFilter(rounds) {
  const sel = document.getElementById('roundFilter');
  const prev = sel.value;
  sel.innerHTML = '<option value="all">All rounds</option>'
    + rounds.map(r => `<option value="${r}">Round ${r}</option>`).join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  else sel.value = 'all';
}
```

### 12.5 Verification checklist

- [ ] Set search filter to "Table 12", switch to Insights, switch back to Logs — filter still shows "Table 12"
- [ ] Set type filter to "Drops", refresh the page — type filter restores to "Drops"
- [ ] Set auto-refresh to 60 s, refresh the page — interval restores and timer resumes at 60 s
- [ ] Selecting a round that no longer exists after switching tournaments falls back to "All rounds"
- [ ] `clearSeen()` does not reset filter state

---

## QoL 13 — "What Changed Since Last Sync" Diff Banner

**Goal:** After each live sync, show a collapsible banner in the Logs tab listing new drops, extensions, and penalties by count since the previous load. More informative than the existing status bar text.

### 13.1 Track previous state in `fetchAll()`

Before calling `normalizeAll(data)`:

```javascript
const _prevDropCount = (rawData.drops     || []).length;
const _prevExtCount  = (rawData.time_logs || []).length;
const _prevPenCount  = (rawData.penalties || []).length;
```

After `normalizeAll()`:

```javascript
const newDrops = (rawData.drops     || []).length - _prevDropCount;
const newExts  = (rawData.time_logs || []).length - _prevExtCount;
const newPens  = (rawData.penalties || []).length - _prevPenCount;
_renderDiffBanner(newDrops, newExts, newPens, fromCache);
```

Module-level sentinel so the banner is suppressed on the first (cold) load:

```javascript
let _diffBannerReady = false; // set to true after first successful fetchAll()
```

### 13.2 New function `_renderDiffBanner(drops, exts, pens, fromCache)`

```javascript
function _renderDiffBanner(drops, exts, pens, fromCache) {
  const container = document.getElementById('diffBanner');
  if (!container) return;
  if (!_diffBannerReady || fromCache || (drops === 0 && exts === 0 && pens === 0)) {
    container.style.display = 'none';
    _diffBannerReady = true;
    return;
  }
  _diffBannerReady = true;

  const parts = [];
  if (drops > 0) parts.push(`${drops} new drop${drops !== 1 ? 's' : ''}`);
  if (exts  > 0) parts.push(`${exts} new extension${exts !== 1 ? 's' : ''}`);
  if (pens  > 0) parts.push(`${pens} new penalt${pens !== 1 ? 'ies' : 'y'}`);

  container.style.display = 'flex';
  container.innerHTML = `
    <span class="diff-banner-icon">↑</span>
    <span class="diff-banner-text">${parts.join(' · ')} since last sync</span>
    <button class="btn btn-sm" style="margin-left:auto"
      onclick="this.closest('#diffBanner').style.display='none'">Dismiss</button>`;
}
```

### 13.3 HTML placement

Add `#diffBanner` immediately above `#logSections` in the Logs tab:

```html
<div id="diffBanner" class="diff-banner" style="display:none"></div>
```

### 13.4 CSS

```css
.diff-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(124,106,247,.08);
  border: 1px solid rgba(124,106,247,.25);
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 12px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--accent-bright);
}
.diff-banner-icon { font-size: 14px; font-weight: 700; }
.diff-banner-text { flex: 1; }
```

### 13.5 Verification checklist

- [ ] Banner does not appear on the first page load (cold start)
- [ ] Banner does not appear when loading from cache (`/api/logs`) — only after a live sync (`/api/sync`)
- [ ] Banner correctly counts: if previous sync had 10 drops and current has 13, shows "3 new drops"
- [ ] Dismiss button hides the banner; it reappears only after the next sync with changes
- [ ] Banner shows nothing if sync returns no new rows (container hidden, not empty-visible)
- [ ] Multiple categories: "2 new drops · 1 new extension" concatenated with ` · `

---

## Implementation Order Summary

| # | Item | Backend? | Complexity | Ships independently? |
|---|------|----------|-----------|----------------------|
| 1 | Extension logistics filtering | No | Low | Yes — implement first |
| 5 | Tab badge | No | Low | Yes |
| 8 | Quick filter presets | No | Low | Yes |
| 11 | Keyboard shortcuts | No | Low | Yes |
| 12 | Filter persistence | No | Low–Med | Yes |
| 9 | Copy round summary | No | Low | After QoL 1 recommended |
| 3 | Pace indicator | No | Low–Med | Yes |
| 13 | Diff banner | No | Medium | Yes |
| 7 | Collapsible log rounds | No | Medium | Yes |
| 2 | Round comparison | No | Medium | After QoL 1 |
| 10 | Trend table | No | Medium | After QoL 1 |
| 4 | Extension histogram | No | Medium | After QoL 1 |
| 6 | Operator notes | **Yes** | Medium | Last — only backend item |

---

## Critical Files

- [`../index.html`](../index.html) — all frontend changes (QoL 1–5, 7–13)
- [`../serve.py`](../serve.py) — QoL 6 only: `operator_notes` DB migration + `PATCH /api/round-notes` endpoint
- [`../agent/AGENT_CONTEXT.md`](../agent/AGENT_CONTEXT.md) — update after QoL 6 to document the new endpoint and DB column
