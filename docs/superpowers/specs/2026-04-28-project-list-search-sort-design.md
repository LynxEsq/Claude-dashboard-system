# Project list — search filter + sort modes

**Status:** approved design, ready for implementation plan
**Date:** 2026-04-28
**Scope:** csm (claude-session-manager) — left column of the web dashboard

## Goal

Add a filter input and a sort selector at the top of the project list in the left column, with three sort modes:

1. **Recent activity** (default) — projects the user worked in most recently are on top.
2. **Added** — by date of creation in CSM (newest on top).
3. **Name** — alphabetical.

Default sort is persisted across reloads (localStorage). Filter text is not persisted.

## Definition of "activity"

Activity is **any user-initiated action against a project**, not the tmux poll status. The following events bump `last_activity_at`:

| # | Trigger | Source |
|---|---|---|
| 1 | User input to project terminal | `POST /api/sessions/:name/send` |
| 2 | Raw keys / terminal input | `POST /api/sessions/:name/keys`, `POST /api/sessions/:name/terminal` |
| 3 | Task launched (silent or interactive) | `pipeline.launchTask()` |
| 4 | Session created | `POST /api/sessions/create` |
| 5 | Session restart / tmux recreate | `POST /api/sessions/:name/restart`, `POST /api/sessions/:name/recreate-tmux` |
| 6 | Input to a task's tmux session | `POST /api/tasks/:taskId/send`, `POST /api/tasks/:taskId/keys` (resolved to project name via pipeline mapping) |
| 7 | Wish (inbox item) created | wish creation route |

Explicitly **not** activity:
- `POST /api/sessions/:name/focus` (selecting/viewing a project)
- Tmux poll status changes (`monitor.js` polling)

`status_log` is not used as a sort source — it is dominated by 3-second poll noise and does not reflect user intent.

## Architecture

### Storage — new SQLite table

Lives in `~/.csm/history.db` alongside existing `status_log`, `token_snapshots`, `alerts`.

```sql
CREATE TABLE IF NOT EXISTS session_activity (
  session_name TEXT PRIMARY KEY,
  last_activity_at INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);
```

All timestamps are ms-since-epoch (`Date.now()`). Single `INSERT OR REPLACE` per bump (cheap under WAL).

### Backfill (existing sessions on first run)

On server startup, for each session in `config.sessions` that has no row in `session_activity`, insert one with synthesized timestamps preserving config-array order: first session gets the oldest synthesized ts, last gets the most recent. Formula: `synthetic = now - (sessions.length - i) * 1000`. `last_activity_at` is initialized equal to `added_at`.

`ensureActivityRow()` uses `INSERT OR IGNORE` so existing rows are never overwritten.

### Data flow

```
[user action]
  → http route handler
  → ctx.bumpActivity(name):
        history.bumpActivity(name)              // INSERT OR REPLACE
        monitor.setActivity(name, ts)           // refresh in-memory cache
        broadcast({type: 'activityBump', data: {name, lastActivityAt: ts}})

[ws client]
  → activityBump:
        State.sessions[name].lastActivityAt = ts
        if sort === 'activity' && wouldReorder(name, ts):
            State.hasNewActivity = true
        renderProjects()    // re-renders, but does NOT re-sort

[user clicks indicator OR changes sort OR session created/removed]
  → rebuildProjectSnapshot()  // resets hasNewActivity, recomputes order
  → renderProjects()
```

### Read path

`/api/sessions` returns `monitor.getState()`, which now embeds `lastActivityAt` and `addedAt` per session. Monitor reads `history.getActivityMap()` once at startup into an in-memory map; `bumpActivity` updates both DB and map; map is delivered with every `getState()` call without further DB hits.

## Backend changes

### `csm/src/lib/history.js`

Add to `initTables()`:
```sql
CREATE TABLE IF NOT EXISTS session_activity (
  session_name TEXT PRIMARY KEY,
  last_activity_at INTEGER NOT NULL,
  added_at INTEGER NOT NULL
);
```

New exported functions:
- `bumpActivity(sessionName) -> ts` — `INSERT ... ON CONFLICT DO UPDATE SET last_activity_at = excluded.last_activity_at`. Returns the new ts.
- `ensureActivityRow(sessionName, addedAt)` — `INSERT OR IGNORE` (used for backfill).
- `getActivityMap() -> { [name]: { lastActivityAt, addedAt } }` — read all rows.
- `deleteActivity(sessionName)` — clean up on session removal.

### `csm/src/lib/monitor.js`

- On startup, after loading config: `this.activity = history.getActivityMap()`.
- New method: `setActivity(name, ts)` — updates `this.activity[name].lastActivityAt = ts`; if name absent, creates entry with `addedAt = ts`.
- `getState()` (and per-session getter) merges `lastActivityAt` and `addedAt` from `this.activity` into each session object.

### Backfill — server startup

In `csm/src/index.js` (or wherever services are wired), after `config.load()` and `history.initTables()` and before serving requests:

```js
const sessions = config.listSessions();
const map = history.getActivityMap();
const now = Date.now();
sessions.forEach((s, i) => {
  if (!map[s.name]) {
    history.ensureActivityRow(s.name, now - (sessions.length - i) * 1000);
  }
});
```

### `csm/src/web/index.js` (or main app wiring)

Expose a single helper through `ctx`:

```js
ctx.bumpActivity = (name) => {
  if (!name) return;
  const ts = history.bumpActivity(name);
  if (ctx.monitor) ctx.monitor.setActivity(name, ts);
  ctx.broadcast({ type: 'activityBump', data: { name, lastActivityAt: ts } });
};
```

### Bump call sites

- `csm/src/web/routes/sessions.js`:
  - `POST /api/sessions/:name/send` → `ctx.bumpActivity(req.params.name)`
  - `POST /api/sessions/:name/keys` → same
  - `POST /api/sessions/:name/terminal` → same
  - `POST /api/sessions/:name/restart` → same
  - `POST /api/sessions/:name/recreate-tmux` → same
  - `POST /api/sessions/create` → `ctx.bumpActivity(req.body.name)` after successful creation
  - `POST /api/tasks/:taskId/send` → resolve project name from pipeline mapping, then bump
  - `POST /api/tasks/:taskId/keys` → same

- `csm/src/lib/pipeline.js`:
  - `launchTask(...)` (and silent variant) → `ctx.bumpActivity(projectName)` after successful launch. If `pipeline.js` does not have access to `ctx`, pass `bumpActivity` in via constructor/options.

- `csm/src/web/routes/pipeline.js`:
  - `POST /api/pipeline/:name/wishes` → `ctx.bumpActivity(req.params.name)` after a wish is created.

- `csm/src/lib/config.js`:
  - `removeSession(name)` → also call `history.deleteActivity(name)` so dead rows are not left behind. Pass `history` in or wire via the same module that exposes both.

### `pipeline.js` — task→project resolution

If pipeline does not already expose a way to map `taskId → project session name`, add `pipeline.getProjectName(taskId)` that reads from the existing task/session mapping. Use it in the `/api/tasks/:taskId/...` handlers before bumping.

## Frontend changes

### `csm/public/js/state.js`

Add to `State`:
```js
projectFilter: '',                  // current filter input value
projectSort: 'activity',            // 'activity' | 'added' | 'name'
projectListSnapshot: [],            // sorted project names — stable until refresh
hasNewActivity: false,              // C3 indicator flag
```

Initialize `projectSort` from `localStorage.getItem('csm.projectSort') || 'activity'`. `projectFilter` always starts empty.

### `csm/public/js/render.js` (or `state.js`)

New helper:
```js
function rebuildProjectSnapshot() {
  const names = Object.keys(State.sessions);
  const sorted = [...names];
  switch (State.projectSort) {
    case 'name':
      sorted.sort((a, b) => a.localeCompare(b));
      break;
    case 'added':
      sorted.sort((a, b) =>
        (State.sessions[b].addedAt || 0) - (State.sessions[a].addedAt || 0)
      );
      break;
    case 'activity':
    default:
      sorted.sort((a, b) =>
        (State.sessions[b].lastActivityAt || 0) - (State.sessions[a].lastActivityAt || 0)
      );
  }
  State.projectListSnapshot = sorted;
  State.hasNewActivity = false;
}

function wouldReorder(name, newTs) {
  const idx = State.projectListSnapshot.indexOf(name);
  if (idx <= 0) return false;             // already on top or not in list
  for (let i = 0; i < idx; i++) {
    const other = State.projectListSnapshot[i];
    const otherTs = State.sessions[other]?.lastActivityAt || 0;
    if (otherTs < newTs) return true;
  }
  return false;
}
```

Snapshot is rebuilt only:
- on first `state` from WS (initial load),
- when a session is created or removed,
- when sort mode changes,
- when the activity indicator is clicked.

It is **not** rebuilt on `update`, `statusChange`, or `activityBump` — those keep the existing order.

### `renderProjects()` updates

After existing skeleton/empty-state checks:
- Lazy-build snapshot on first call: `if snapshot empty && sessions present → rebuildProjectSnapshot()`.
- Filter: `visible = snapshot.filter(name => name.toLowerCase().includes(filter))` (case-insensitive substring on name only — option a1).
- Empty-after-filter message: `"No projects match the filter."`.
- Render the visible array using the existing per-item template (unchanged).
- Toggle `#activityIndicator.style.display` based on `State.hasNewActivity`.

### `csm/public/js/websocket.js`

New case:
```js
case 'activityBump': {
  const { name, lastActivityAt } = msg.data;
  if (State.sessions[name]) {
    State.sessions[name].lastActivityAt = lastActivityAt;
  }
  if (State.projectSort === 'activity' && wouldReorder(name, lastActivityAt)) {
    State.hasNewActivity = true;
  }
  renderProjects();
  break;
}
```

Existing handlers — adjust:
- `case 'state'`: after assigning `State.sessions = msg.data` and `State.loading = false`, call `rebuildProjectSnapshot()`.
- `case 'update'`: detect when a new session appears (`!previously in snapshot`) or disappears, and call `rebuildProjectSnapshot()` in those cases. Plain status/token updates do not rebuild.

### `csm/public/js/actions.js`

```js
function onProjectFilterInput(e) {
  State.projectFilter = e.target.value;
  renderProjects();
}

function onProjectSortChange(value) {
  State.projectSort = value;
  localStorage.setItem('csm.projectSort', value);
  rebuildProjectSnapshot();
  renderProjects();
}

function onActivityIndicatorClick() {
  rebuildProjectSnapshot();
  renderProjects();
}
```

### `csm/public/index.html`

Insert toolbar between `.col-header` and `#projectList`:

```html
<div class="col">
  <div class="col-header">
    Projects
    <button class="btn sm primary" onclick="showModal('create')">+</button>
  </div>
  <div class="project-list-toolbar">
    <input
      type="text"
      id="projectFilter"
      class="project-filter-input"
      placeholder="Filter projects..."
      oninput="onProjectFilterInput(event)">
    <button
      id="activityIndicator"
      class="activity-indicator"
      title="New activity — click to re-sort"
      onclick="onActivityIndicatorClick()"
      style="display:none">●</button>
    <select
      id="projectSortSelect"
      class="project-sort-select"
      onchange="onProjectSortChange(this.value)">
      <option value="activity">Recent</option>
      <option value="added">Added</option>
      <option value="name">Name</option>
    </select>
  </div>
  <div class="col-body" id="projectList">
    <div class="empty-msg">No projects yet</div>
  </div>
</div>
```

On init (after DOM ready, before first render): `el('projectSortSelect').value = State.projectSort`.

### `csm/public/css/components.css`

```css
.project-list-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.project-filter-input {
  flex: 1;
  min-width: 0;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  padding: 4px 8px;
  font-size: 12px;
  font-family: inherit;
}
.project-filter-input:focus {
  outline: none;
  border-color: var(--blue);
}
.project-filter-input::placeholder { color: var(--text2); }

.project-sort-select {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  padding: 4px 6px;
  font-size: 12px;
  cursor: pointer;
}

.activity-indicator {
  background: transparent;
  border: none;
  color: var(--blue);
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  cursor: pointer;
  animation: pulse 1.6s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}
```

CSS variable names (`--bg`, `--bg2`, `--border`, `--text`, `--text2`, `--blue`) follow the existing token naming in `main.css`. Verify and adjust during implementation if any are absent.

## Selected-project behavior

If `State.selected` is filtered out by the search input, **do not** clear `State.selected` — keep wishes/tasks columns rendering for that project. When the filter is cleared, the project reappears in the list with its highlight intact.

## Test plan

This project does not appear to have a formal frontend test runner. Plan: add unit tests only where dependency is already present (check `csm/test/` for existing infrastructure during implementation), otherwise rely on the manual checklist below. Do not introduce a test framework for this feature alone.

### Unit tests (if infrastructure available)

- `history.bumpActivity()`: creates a row with `last_activity_at = added_at` on first call; subsequent calls update `last_activity_at` only.
- `history.ensureActivityRow()`: does not overwrite existing rows.
- `history.deleteActivity()`: removes row.
- `history.getActivityMap()`: returns map keyed by session_name with both timestamp fields.
- Backfill function: produces strictly increasing synthetic timestamps in config-array order; preserves rows that already exist.
- `rebuildProjectSnapshot` (after extracting to a pure function `sortProjects(sessions, sort) -> string[]`): returns expected order for each of the three modes; handles ties and `null` timestamps deterministically.
- `wouldReorder(name, ts, snapshot, sessions)`: true when an earlier-positioned project has a smaller `lastActivityAt`; false when `name` is at index 0 or absent.

### Manual checklist

**Backend / DB:**
- [ ] Fresh install (no `session_activity` table): server starts, table is created, existing sessions are backfilled in config order.
- [ ] Existing DB with `session_activity` already populated: backfill does not overwrite existing rows.
- [ ] `POST /api/sessions/:name/send` bumps `last_activity_at` and emits WS `activityBump`.
- [ ] Same for `/keys`, `/terminal`, `/restart`, `/recreate-tmux`, `/api/sessions/create`, `/api/tasks/:id/send`, `/api/tasks/:id/keys`, pipeline launch (silent + interactive), wish creation.
- [ ] `/api/sessions/:name/focus` does **not** bump (negative test).
- [ ] Removing a session deletes its `session_activity` row.
- [ ] `/api/sessions` includes `lastActivityAt` and `addedAt` in each session.

**Frontend / UI:**
- [ ] Toolbar appears below header in the left column without breaking existing layout.
- [ ] Default sort is `activity`; the most recently active project is on top right after load.
- [ ] Switching sort to `name` produces alphabetical order; switching to `added` produces newest-first by creation time. Snapshot rebuilds; indicator clears.
- [ ] localStorage persists sort across reloads. Filter text is empty after reload.
- [ ] Filter (a1): substring, case-insensitive, on name only. Empty result → "No projects match the filter." Empty filter → all projects.
- [ ] Selected project filtered out: selection is preserved in state; wishes/tasks columns continue rendering; clearing the filter brings the project back highlighted.

**C3 indicator:**
- [ ] Activity in a project not on top + sort=activity → indicator appears, order does not change.
- [ ] Click indicator → snapshot rebuilds, project moves to top, indicator hides.
- [ ] Activity in a project already on top → indicator does NOT appear (e1).
- [ ] Activity while sort = `name` or `added` → indicator does NOT appear.

**Regressions:**
- [ ] Click-to-select project, right-click context menu, delete `×`, token bar, status dot, task progress bar, planning dot — all continue to work.
- [ ] WS `update` / `statusChange`: status dot and tokens update live; project order does NOT change.
- [ ] Skeleton loading on first connect.
- [ ] Creating a new session via `+` makes it appear at the top under sort=activity.

## Out of scope

- Pagination or virtualization (for >100 projects).
- Server-side activity aggregation API.
- Per-project trend indicators ("most worked-in this week").
- Project grouping / folders / tags.
- Hotkey for filter focus (deferred — d1).
- Persisting filter text across reloads (deferred — c1).
- Fuzzy matching (deferred — substring is sufficient for typical project counts).
