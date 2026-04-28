# Project list — search filter + sort modes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a filter input + 3-mode sort selector to the project list in the left column, with a "new activity" indicator that lets the user opt into re-sorting without surprise jumps.

**Architecture:** New SQLite table `session_activity` (in `~/.csm/history.db`) tracks per-session `last_activity_at` and `added_at`. Activity bumps fire on user-initiated actions only (not tmux polls). Server pushes `activityBump` over WebSocket; client keeps a stable `projectListSnapshot` and only re-sorts on explicit user action (sort change, indicator click) or session add/remove.

**Tech Stack:** Node.js + Express + `better-sqlite3` (backend), vanilla JS + WebSocket (frontend), Node-runnable test scripts (no framework — matches existing `csm/test/detector.test.js` pattern).

---

## File Structure

**Backend:**
- `csm/src/lib/history.js` — modify: add `session_activity` table init + 4 new functions (`bumpActivity`, `ensureActivityRow`, `getActivityMap`, `deleteActivity`)
- `csm/src/lib/monitor.js` — modify: hold in-memory activity map, merge timestamps into `getState()` / `getSessionState()`, expose `setActivity(name, ts)`
- `csm/src/web/server.js` — modify: backfill activity rows on startup, expose `ctx.bumpActivity(name)` helper
- `csm/src/web/routes/sessions.js` — modify: bump on 7 endpoints, delete activity row on session removal in 2 endpoints
- `csm/src/web/routes/pipeline.js` — modify: bump on wish creation + 3 task-execution endpoints

**Frontend:**
- `csm/public/js/state.js` — modify: add `projectFilter`, `projectSort`, `projectListSnapshot`, `hasNewActivity`
- `csm/public/js/render.js` — modify: extract pure `sortProjects` / `wouldReorder` helpers, modify `renderProjects()` to filter snapshot and toggle indicator
- `csm/public/js/actions.js` — modify: add 3 handlers (`onProjectFilterInput`, `onProjectSortChange`, `onActivityIndicatorClick`)
- `csm/public/js/websocket.js` — modify: handle `activityBump`; rebuild snapshot when a session is added or removed
- `csm/public/index.html` — modify: insert toolbar between `.col-header` and `#projectList`; init sort select from `State.projectSort`
- `csm/public/css/components.css` — modify: add `.project-list-toolbar`, `.project-filter-input`, `.project-sort-select`, `.activity-indicator`

**Tests:**
- `csm/test/history-activity.test.js` — create: unit tests for the new history functions
- `csm/test/sort-projects.test.js` — create: unit tests for `sortProjects` and `wouldReorder` pure functions

---

## Task 1: Backend — `session_activity` table + history functions (TDD)

**Files:**
- Create: `csm/test/history-activity.test.js`
- Modify: `csm/src/lib/history.js`

- [ ] **Step 1.1: Write failing tests**

Create `csm/test/history-activity.test.js`:

```js
/**
 * Tests for session_activity table in history.js.
 *
 * Run: node csm/test/history-activity.test.js
 *
 * Uses an isolated tmp DB by setting CSM_DB_FILE so production DB is untouched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate DB by pointing utils.openDatabase at a tmp file.
// We override the path before requiring history.js.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-test-'));
const tmpDb = path.join(tmpDir, 'history.db');

// Patch utils.openDatabase BEFORE requiring history.js so the patched
// version is captured in history's closure. We must build the Database
// directly with our tmp path because the original openDatabase prepends
// CONFIG_DIR.
const Database = require('better-sqlite3');
const utils = require('../src/lib/utils');
utils.openDatabase = (name) => {
  if (name === 'history.db') {
    const db = new Database(tmpDb);
    db.pragma('journal_mode = WAL');
    return db;
  }
  // For any other DB name, fall back to ../src/lib/utils default behavior.
  // (Not expected in this test suite.)
  throw new Error(`Unexpected openDatabase('${name}') in test`);
};

const history = require('../src/lib/history');

let passed = 0;
let failed = 0;

function assert(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

function assertTrue(name, cond) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL: ${name}`); }
}

// ─── Tests ─────────────────────────────────────────────

// 1. bumpActivity creates a row on first call
const ts1 = history.bumpActivity('proj-A');
const map1 = history.getActivityMap();
assertTrue('bumpActivity creates row', !!map1['proj-A']);
assert('bumpActivity sets last_activity_at = added_at on insert',
  map1['proj-A'].lastActivityAt, map1['proj-A'].addedAt);
assertTrue('bumpActivity returns ts', typeof ts1 === 'number' && ts1 > 0);

// 2. bumpActivity updates only last_activity_at on second call
const addedAtBefore = map1['proj-A'].addedAt;
// Guarantee a different ts even on fast machines
const sleepMs = 5;
const startSleep = Date.now();
while (Date.now() - startSleep < sleepMs) { /* spin */ }
const ts2 = history.bumpActivity('proj-A');
const map2 = history.getActivityMap();
assertTrue('bumpActivity advances last_activity_at',
  map2['proj-A'].lastActivityAt > addedAtBefore);
assert('bumpActivity preserves added_at',
  map2['proj-A'].addedAt, addedAtBefore);

// 3. ensureActivityRow inserts when absent
history.ensureActivityRow('proj-B', 1700000000000);
const map3 = history.getActivityMap();
assert('ensureActivityRow inserts addedAt',
  map3['proj-B'].addedAt, 1700000000000);
assert('ensureActivityRow inserts lastActivityAt = addedAt',
  map3['proj-B'].lastActivityAt, 1700000000000);

// 4. ensureActivityRow does NOT overwrite existing row
history.ensureActivityRow('proj-B', 9999999999999);
const map4 = history.getActivityMap();
assert('ensureActivityRow preserves existing addedAt',
  map4['proj-B'].addedAt, 1700000000000);

// 5. deleteActivity removes row
history.deleteActivity('proj-A');
const map5 = history.getActivityMap();
assertTrue('deleteActivity removes row', !map5['proj-A']);
assertTrue('deleteActivity leaves other rows', !!map5['proj-B']);

// 6. getActivityMap returns empty object when no rows
history.deleteActivity('proj-B');
const map6 = history.getActivityMap();
assert('getActivityMap returns {} when empty', map6, {});

// ─── Report ────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `node csm/test/history-activity.test.js`
Expected: FAIL — `history.bumpActivity is not a function` (or similar — the functions don't exist yet).

- [ ] **Step 1.3: Add table + functions to `history.js`**

In `csm/src/lib/history.js`:

(a) Add `session_activity` to `initTables()` — append after the existing `CREATE INDEX` lines but inside the same `db.exec()` template literal:

```js
function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS status_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_name TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      tokens_used INTEGER,
      tokens_total INTEGER,
      timestamp DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS token_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_name TEXT NOT NULL,
      tokens_used INTEGER,
      tokens_total INTEGER,
      timestamp DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_name TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      message TEXT,
      acknowledged INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session_activity (
      session_name TEXT PRIMARY KEY,
      last_activity_at INTEGER NOT NULL,
      added_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_status_log_session
      ON status_log(session_name, timestamp);
    CREATE INDEX IF NOT EXISTS idx_token_snapshots_session
      ON token_snapshots(session_name, timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_session
      ON alerts(session_name, acknowledged);
  `);
}
```

(b) Add four new functions (anywhere before `module.exports`):

```js
function bumpActivity(sessionName) {
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO session_activity (session_name, last_activity_at, added_at)
    VALUES (?, ?, ?)
    ON CONFLICT(session_name) DO UPDATE SET last_activity_at = excluded.last_activity_at
  `).run(sessionName, now, now);
  return now;
}

function ensureActivityRow(sessionName, addedAt) {
  getDb().prepare(`
    INSERT OR IGNORE INTO session_activity (session_name, last_activity_at, added_at)
    VALUES (?, ?, ?)
  `).run(sessionName, addedAt, addedAt);
}

function getActivityMap() {
  const rows = getDb().prepare(
    'SELECT session_name, last_activity_at, added_at FROM session_activity'
  ).all();
  const map = {};
  for (const r of rows) {
    map[r.session_name] = {
      lastActivityAt: r.last_activity_at,
      addedAt: r.added_at,
    };
  }
  return map;
}

function deleteActivity(sessionName) {
  getDb().prepare('DELETE FROM session_activity WHERE session_name = ?').run(sessionName);
}
```

(c) Add to `module.exports`:

```js
module.exports = {
  logStatus,
  logTokenSnapshot,
  createAlert,
  acknowledgeAlert,
  getUnacknowledgedAlerts,
  getStatusHistory,
  getTokenHistory,
  getAllTokenHistory,
  getSessionTimeline,
  bumpActivity,
  ensureActivityRow,
  getActivityMap,
  deleteActivity,
  cleanup,
  close,
};
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `node csm/test/history-activity.test.js`
Expected: `6 passed, 0 failed`. Exit code 0.

- [ ] **Step 1.5: Commit**

```bash
git add csm/src/lib/history.js csm/test/history-activity.test.js
git commit -m "Add session_activity table and bump/ensure/get/delete helpers"
```

---

## Task 2: Backend — `monitor.js` exposes activity timestamps

**Files:**
- Modify: `csm/src/lib/monitor.js`

This task threads `lastActivityAt` and `addedAt` into the monitor's per-session state so they appear in `/api/sessions` and WS `update` messages. No tests — this is a thin wiring change verified manually in Task 4.

- [ ] **Step 2.1: Initialize activity map in constructor and `start()`/`reload()`**

In `csm/src/lib/monitor.js`, modify the `constructor`:

```js
constructor() {
  super();
  this.sessions = new Map();   // name -> session state
  this.interval = null;
  this.alertTimers = new Map(); // name -> { needsInputSince, idleSince }
  this.activity = {};           // name -> { lastActivityAt, addedAt }
}
```

In `start()`, after `for (const sess of cfg.sessions) { ... }` block (around line 32) and before `this.poll()`, load the activity map:

```js
// existing loop ends with `}`
}

// Load activity timestamps from DB.
this.activity = history.getActivityMap();

this.poll(); // immediate first poll
```

In `reload()`, after the add/remove logic (after line 75, before the closing `}`), refresh the activity map so newly-created sessions appear:

```js
// Remove deleted sessions
for (const name of currentNames) {
  if (!configNames.has(name)) {
    this.sessions.delete(name);
    this.alertTimers.delete(name);
  }
}

// Refresh activity map (new sessions may have been backfilled / bumped on creation).
this.activity = history.getActivityMap();
}
```

- [ ] **Step 2.2: Add `setActivity()` method**

Inside `class SessionMonitor`, after `focusSession()` and before the closing `}`:

```js
setActivity(name, ts) {
  const cur = this.activity[name];
  if (cur) {
    cur.lastActivityAt = ts;
  } else {
    this.activity[name] = { lastActivityAt: ts, addedAt: ts };
  }
}
```

- [ ] **Step 2.3: Merge activity into `getState()` and `getSessionState()`**

Replace `getState()` and `getSessionState()`:

```js
getState() {
  const state = {};
  for (const [name, session] of this.sessions) {
    const a = this.activity[name];
    state[name] = {
      ...session,
      lastActivityAt: a?.lastActivityAt ?? null,
      addedAt: a?.addedAt ?? null,
    };
  }
  return state;
}

getSessionState(name) {
  const session = this.sessions.get(name);
  if (!session) return null;
  const a = this.activity[name];
  return {
    ...session,
    lastActivityAt: a?.lastActivityAt ?? null,
    addedAt: a?.addedAt ?? null,
  };
}
```

- [ ] **Step 2.4: Smoke-test the change**

Start the server (or restart if running) and `curl` the API:

```bash
node csm/src/index.js --web --dev &
sleep 2
curl -s http://localhost:9847/api/sessions | head -c 500
```

Expected: each session object in the JSON response includes `"lastActivityAt"` and `"addedAt"` (likely both `null` on first run before backfill — that is fine; backfill is added in Task 3).

Stop the server with `kill %1` (or Ctrl+C if running in foreground).

- [ ] **Step 2.5: Commit**

```bash
git add csm/src/lib/monitor.js
git commit -m "Surface lastActivityAt and addedAt in monitor.getState()"
```

---

## Task 3: Backend — Backfill on startup + `ctx.bumpActivity` helper

**Files:**
- Modify: `csm/src/web/server.js`

- [ ] **Step 3.1: Add backfill call and `ctx.bumpActivity` to `server.js`**

In `csm/src/web/server.js`, modify `start()`. Find this existing section (around lines 39-45):

```js
// ─── Route modules ──────────────────────────────────

const ctx = { monitor: null, wss, pipeline, broadcast, config, tmux, history, platform };

require('./routes/sessions')(app, ctx);
require('./routes/pipeline')(app, ctx);
require('./routes/system')(app, ctx);
```

Replace with:

```js
// ─── Route modules ──────────────────────────────────

// Backfill session_activity for any sessions in config without a row.
// First-in-array sessions get the oldest synthesized timestamps.
{
  const sessions = config.listSessions();
  const map = history.getActivityMap();
  const now = Date.now();
  sessions.forEach((s, i) => {
    if (!map[s.name]) {
      const synthetic = now - (sessions.length - i) * 1000;
      history.ensureActivityRow(s.name, synthetic);
    }
  });
}

const ctx = { monitor: null, wss, pipeline, broadcast, config, tmux, history, platform };

// Helper: bump activity → DB + monitor cache + WS broadcast. Single source of truth.
ctx.bumpActivity = (name) => {
  if (!name) return;
  const ts = history.bumpActivity(name);
  if (ctx.monitor) ctx.monitor.setActivity(name, ts);
  broadcast(wss, { type: 'activityBump', data: { name, lastActivityAt: ts } });
};

require('./routes/sessions')(app, ctx);
require('./routes/pipeline')(app, ctx);
require('./routes/system')(app, ctx);
```

- [ ] **Step 3.2: Smoke-test backfill and WS broadcast**

Start the server, register a test session via the API (or use one that already exists), then check:

```bash
node csm/src/index.js --web --dev &
sleep 2
curl -s http://localhost:9847/api/sessions | python3 -m json.tool | head -40
```

Expected: every session has non-null `lastActivityAt` and `addedAt` numbers (epoch ms). Older sessions in `config.json` order have smaller `addedAt`.

Stop the server with `kill %1`.

- [ ] **Step 3.3: Commit**

```bash
git add csm/src/web/server.js
git commit -m "Backfill session_activity on startup and add ctx.bumpActivity helper"
```

---

## Task 4: Backend — Bump activity in `routes/sessions.js`

**Files:**
- Modify: `csm/src/web/routes/sessions.js`

Wire `ctx.bumpActivity` into 7 endpoints; clean up `session_activity` row on 2 endpoints that destroy a session.

- [ ] **Step 4.1: Bump on `/send`**

Find (around line 17):

```js
app.post('/api/sessions/:name/send', safe((req, res) => {
  const { input } = req.body;
  if (!input) return res.status(400).json({ error: 'No input provided' });
  const ok = ctx.monitor?.sendInput(req.params.name, input);
  res.json({ success: ok });
}));
```

Add `ctx.bumpActivity(req.params.name)` after a successful send:

```js
app.post('/api/sessions/:name/send', safe((req, res) => {
  const { input } = req.body;
  if (!input) return res.status(400).json({ error: 'No input provided' });
  const ok = ctx.monitor?.sendInput(req.params.name, input);
  if (ok) ctx.bumpActivity(req.params.name);
  res.json({ success: ok });
}));
```

- [ ] **Step 4.2: Bump on `/keys`**

Find (around line 159) the `app.post('/api/sessions/:name/keys', ...)` handler. After the successful `tmux.sendKeys(...)` (or whatever the success path is), add `ctx.bumpActivity(req.params.name)`. Read the current code first:

```bash
sed -n '155,180p' csm/src/web/routes/sessions.js
```

Then, in the handler body, immediately before `res.json(...)` on the success branch, insert:

```js
ctx.bumpActivity(req.params.name);
```

- [ ] **Step 4.3: Bump on `/terminal`**

Same as Step 4.2 but for the `/api/sessions/:name/terminal` handler (around line 179). Read with:

```bash
sed -n '175,210p' csm/src/web/routes/sessions.js
```

Insert `ctx.bumpActivity(req.params.name);` immediately before the success `res.json(...)`.

- [ ] **Step 4.4: Bump on `/restart`**

Find (around line 126) `app.post('/api/sessions/:name/restart', ...)`. Insert `ctx.bumpActivity(req.params.name);` immediately before the success `res.json(...)`.

- [ ] **Step 4.5: Bump on `/recreate-tmux`**

Find (around line 141) `app.post('/api/sessions/:name/recreate-tmux', ...)`. Insert `ctx.bumpActivity(req.params.name);` immediately before the success `res.json(...)`.

- [ ] **Step 4.6: Bump on `/sessions/create`**

Find (around line 68):

```js
app.post('/api/sessions/create', safe((req, res) => {
  const { name, projectPath, startClaude } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const tmuxName = tmux.safeTmuxName(name);
  const result = tmux.createSession(tmuxName, projectPath || null, startClaude !== false);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  config.addSession(name, tmuxName, { projectPath: projectPath || null });
  ctx.monitor?.reload();
  res.json({ success: true, tmuxSession: tmuxName });
}));
```

Add the bump after `ctx.monitor?.reload()`:

```js
config.addSession(name, tmuxName, { projectPath: projectPath || null });
ctx.monitor?.reload();
ctx.bumpActivity(name);
res.json({ success: true, tmuxSession: tmuxName });
```

- [ ] **Step 4.7: Bump on `/tasks/:taskId/send` and `/tasks/:taskId/keys` (resolve to project name)**

Find (around line 30):

```js
app.post('/api/tasks/:taskId/send', safe((req, res) => {
  const { input } = req.body;
  if (!input) return res.status(400).json({ error: 'No input provided' });
  const mapping = pipeline.getSessionMapping(parseInt(req.params.taskId));
  if (!mapping || mapping.status !== 'active') {
    return res.status(404).json({ error: 'No active session for this task' });
  }
  const ok = tmux.sendKeys(mapping.tmux_session_name, null, null, input);
  res.json({ success: ok });
}));
```

`mapping.session_name` holds the project session name (column defined in `csm/src/lib/pipeline.js:75-93` `session_mappings` table). Modify the handler:

```js
app.post('/api/tasks/:taskId/send', safe((req, res) => {
  const { input } = req.body;
  if (!input) return res.status(400).json({ error: 'No input provided' });
  const mapping = pipeline.getSessionMapping(parseInt(req.params.taskId));
  if (!mapping || mapping.status !== 'active') {
    return res.status(404).json({ error: 'No active session for this task' });
  }
  const ok = tmux.sendKeys(mapping.tmux_session_name, null, null, input);
  if (ok && mapping.session_name) ctx.bumpActivity(mapping.session_name);
  res.json({ success: ok });
}));
```

Then do the same for `/api/tasks/:taskId/keys` (around line 52). Insert `if (mapping.session_name) ctx.bumpActivity(mapping.session_name);` immediately before `res.json({ success: true })` on the success path.

- [ ] **Step 4.8: Delete activity row on `/kill` and `/destroy`**

Find (around line 84):

```js
app.post('/api/sessions/:name/kill', safe((req, res) => {
  const sess = config.findSession(req.params.name);
  if (!sess) return res.status(404).json({ error: 'Session not found' });

  tmux.killSession(sess.tmuxSession);
  config.removeSession(req.params.name);
  ctx.monitor?.reload();
```

Add `history.deleteActivity(req.params.name);` after `config.removeSession(req.params.name);`:

```js
tmux.killSession(sess.tmuxSession);
config.removeSession(req.params.name);
history.deleteActivity(req.params.name);
ctx.monitor?.reload();
```

Do the same in the `/destroy` handler (around line 95) — find `config.removeSession(...)` inside it and insert `history.deleteActivity(req.params.name);` immediately after.

- [ ] **Step 4.9: Smoke-test bumps**

```bash
node csm/src/index.js --web --dev &
sleep 2

# Pick a session name (or create one). Replace SNAME with a real session.
SNAME="<pick-an-existing-session>"
BEFORE=$(curl -s http://localhost:9847/api/sessions | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['$SNAME']['lastActivityAt'])")
echo "Before: $BEFORE"
sleep 1
curl -s -X POST -H 'Content-Type: application/json' -d '{"input":"echo hi"}' http://localhost:9847/api/sessions/$SNAME/send
sleep 1
AFTER=$(curl -s http://localhost:9847/api/sessions | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['$SNAME']['lastActivityAt'])")
echo "After: $AFTER"

kill %1
```

Expected: `AFTER > BEFORE`.

- [ ] **Step 4.10: Commit**

```bash
git add csm/src/web/routes/sessions.js
git commit -m "Bump session_activity on user actions and tasks endpoints"
```

---

## Task 5: Backend — Bump activity in `routes/pipeline.js`

**Files:**
- Modify: `csm/src/web/routes/pipeline.js`

- [ ] **Step 5.1: Bump on wish creation**

Find (around line 24):

```js
app.post('/api/pipeline/:name/wishes', safe((req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  const id = pipeline.addWish(req.params.name, content);
  broadcast(wss, { type: 'wishAdded', data: { sessionName: req.params.name, id, content } });
  res.json({ success: true, id });
}));
```

Add `ctx.bumpActivity(req.params.name);` after `pipeline.addWish(...)`:

```js
const id = pipeline.addWish(req.params.name, content);
ctx.bumpActivity(req.params.name);
broadcast(wss, { type: 'wishAdded', data: { sessionName: req.params.name, id, content } });
```

- [ ] **Step 5.2: Bump on `/execute-interactive`, `/execute-silent`, `/execute`**

Find (around lines 128, 137, 160) the three handlers. In each, add `ctx.bumpActivity(req.params.name);` inside the `if (result.started) { ... }` block, immediately after the existing `broadcast(...)` call.

Example for `/execute-interactive`:

```js
app.post('/api/pipeline/:name/execute-interactive', safe((req, res) => {
  const { taskId, noWorktree } = req.body;
  const result = pipeline.executeTaskInteractive(req.params.name, taskId, { noWorktree });
  if (result.started) {
    broadcast(wss, { type: 'taskStarted', data: { sessionName: req.params.name, ...result } });
    ctx.bumpActivity(req.params.name);
  }
  res.json(result);
}));
```

Apply the same pattern to `/execute-silent` and `/execute`.

- [ ] **Step 5.3: Smoke-test**

```bash
node csm/src/index.js --web --dev &
sleep 2

# With an existing session SNAME, add a wish and confirm bump.
SNAME="<existing-session>"
BEFORE=$(curl -s http://localhost:9847/api/sessions | python3 -c "import sys,json; print(json.load(sys.stdin)['$SNAME']['lastActivityAt'])")
sleep 1
curl -s -X POST -H 'Content-Type: application/json' -d '{"content":"test wish"}' http://localhost:9847/api/pipeline/$SNAME/wishes
sleep 1
AFTER=$(curl -s http://localhost:9847/api/sessions | python3 -c "import sys,json; print(json.load(sys.stdin)['$SNAME']['lastActivityAt'])")
echo "Before=$BEFORE After=$AFTER"

kill %1
```

Expected: `AFTER > BEFORE`.

- [ ] **Step 5.4: Commit**

```bash
git add csm/src/web/routes/pipeline.js
git commit -m "Bump session_activity on wish creation and task launches"
```

---

## Task 6: Frontend — Pure helpers `sortProjects` + `wouldReorder` (TDD)

**Files:**
- Create: `csm/test/sort-projects.test.js`
- Modify: `csm/public/js/render.js` (add helpers)
- Modify: `csm/public/js/state.js` (add new fields)

The pure helpers are extracted so they are unit-testable without a DOM. They live in `render.js` as `window`-attached functions (matching the existing pattern in this codebase where every JS file in `public/js` exposes globals).

- [ ] **Step 6.1: Write failing tests**

Create `csm/test/sort-projects.test.js`:

```js
/**
 * Tests for sortProjects() and wouldReorder() pure helpers.
 *
 * The helpers are defined in csm/public/js/render.js as globals on `window`.
 * For Node-side testing we eval the function definitions in a sandbox-free way
 * by re-defining them inline (mirror of the same logic). If the implementation
 * in render.js diverges, both must be updated together — keep these helpers
 * minimal and dependency-free.
 *
 * Run: node csm/test/sort-projects.test.js
 */

// Import the functions: render.js attaches them to globalThis when not in a
// browser. We require it after stubbing browser globals it does not need.
global.window = global;
global.document = { getElementById: () => null };  // unused by the pure helpers
require('../public/js/render.js');                  // attaches sortProjects + wouldReorder

let passed = 0, failed = 0;
function assert(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else { failed++; console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
}
function assertTrue(name, cond) {
  if (cond) passed++; else { failed++; console.error(`FAIL: ${name}`); }
}

const sessions = {
  alpha:   { lastActivityAt: 100, addedAt: 10 },
  beta:    { lastActivityAt: 300, addedAt: 30 },
  gamma:   { lastActivityAt: 200, addedAt: 20 },
  delta:   { lastActivityAt: null, addedAt: null },  // never bumped, no addedAt
};

// 1. sort by activity — newest first, nulls last
assert('sort activity',
  sortProjects(sessions, 'activity'),
  ['beta', 'gamma', 'alpha', 'delta']);

// 2. sort by added — newest first, nulls last
assert('sort added',
  sortProjects(sessions, 'added'),
  ['beta', 'gamma', 'alpha', 'delta']);

// 3. sort by name — alphabetical
assert('sort name',
  sortProjects(sessions, 'name'),
  ['alpha', 'beta', 'delta', 'gamma']);

// 4. unknown sort defaults to activity
assert('sort unknown defaults to activity',
  sortProjects(sessions, 'whatever'),
  ['beta', 'gamma', 'alpha', 'delta']);

// 5. wouldReorder: bump on a non-top project to a value bigger than head → true
const snapshot = ['beta', 'gamma', 'alpha', 'delta'];
assertTrue('wouldReorder: alpha bumped past beta',
  wouldReorder('alpha', 999, snapshot, sessions));

// 6. wouldReorder: bump on the top project → false
assertTrue('wouldReorder: beta already on top',
  !wouldReorder('beta', 999, snapshot, sessions));

// 7. wouldReorder: bump that does not exceed any earlier project → false
assertTrue('wouldReorder: gamma bumped to 250 (still less than beta=300)',
  !wouldReorder('gamma', 250, snapshot, sessions));

// 8. wouldReorder: project not in snapshot → false
assertTrue('wouldReorder: missing project',
  !wouldReorder('omega', 999, snapshot, sessions));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `node csm/test/sort-projects.test.js`
Expected: FAIL — `sortProjects is not defined`.

- [ ] **Step 6.3: Implement helpers in `render.js`**

In `csm/public/js/render.js`, append these helpers near the top of the file (after any existing top-level vars, before `function renderProjects()`):

```js
function sortProjects(sessions, mode) {
  const names = Object.keys(sessions);
  const sorted = [...names];
  switch (mode) {
    case 'name':
      sorted.sort((a, b) => a.localeCompare(b));
      break;
    case 'added':
      sorted.sort((a, b) => {
        const ax = sessions[a].addedAt;
        const bx = sessions[b].addedAt;
        if (ax == null && bx == null) return a.localeCompare(b);
        if (ax == null) return 1;
        if (bx == null) return -1;
        return bx - ax;
      });
      break;
    case 'activity':
    default:
      sorted.sort((a, b) => {
        const ax = sessions[a].lastActivityAt;
        const bx = sessions[b].lastActivityAt;
        if (ax == null && bx == null) return a.localeCompare(b);
        if (ax == null) return 1;
        if (bx == null) return -1;
        return bx - ax;
      });
  }
  return sorted;
}

function wouldReorder(name, newTs, snapshot, sessions) {
  const idx = snapshot.indexOf(name);
  if (idx <= 0) return false;  // not in list, or already on top
  for (let i = 0; i < idx; i++) {
    const otherTs = sessions[snapshot[i]]?.lastActivityAt ?? 0;
    if (otherTs < newTs) return true;
  }
  return false;
}
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `node csm/test/sort-projects.test.js`
Expected: `8 passed, 0 failed`. Exit code 0.

- [ ] **Step 6.5: Add new state fields to `state.js`**

Edit `csm/public/js/state.js`. Replace the existing `State = { ... }` block with:

```js
/**
 * Global application state
 */
const State = {
  sessions: {},
  selected: null,       // selected project name
  selectedTask: null,   // selected task id
  wishes: [],
  tasks: [],
  alerts: [],
  loading: true,         // skeleton loading state
  taskView: 'list',      // 'list' or 'board'
  editingWish: null,    // wish id being edited
  editingTask: null,    // task id being edited
  planningSession: null, // tmux session name when planning is active
  planningProjects: new Set(), // project names with active planning
  liveMode: true,        // auto-refresh terminal output
  taskCounts: {},        // { sessionName: { completed, running, pending, failed, total } }
  selectedWish: null,    // wish id selected to show linked tasks
  taskDependencies: {},  // { taskId: [{blockerTaskId, blockerTitle, blockerStatus, reason}] }
  taskModes: {},         // { taskId: 'interactive' | 'silent' }
  taskDiffs: {},         // { taskId: { files_changed, insertions, deletions, summary } }
  planningWishIds: new Set(), // wish IDs currently being planned
  platform: { platform: 'unknown', name: 'Unknown', terminal: 'Terminal' },
  isRemote: false,
  sshInfo: { user: '', host: '' },
  // Project list filter / sort
  projectFilter: '',
  projectSort: (typeof localStorage !== 'undefined' && localStorage.getItem('csm.projectSort')) || 'activity',
  projectListSnapshot: [],
  hasNewActivity: false,
};
```

- [ ] **Step 6.6: Commit**

```bash
git add csm/public/js/render.js csm/public/js/state.js csm/test/sort-projects.test.js
git commit -m "Add sortProjects and wouldReorder pure helpers + state fields"
```

---

## Task 7: Frontend — Toolbar HTML + CSS

**Files:**
- Modify: `csm/public/index.html`
- Modify: `csm/public/css/components.css`

- [ ] **Step 7.1: Insert toolbar in `index.html`**

In `csm/public/index.html`, find the existing project-column block (around lines 42-51):

```html
<!-- Column 1: Projects -->
<div class="col">
  <div class="col-header">
    Projects
    <button class="btn sm primary" onclick="showModal('create')">+</button>
  </div>
  <div class="col-body" id="projectList">
    <div class="empty-msg">No projects yet</div>
  </div>
</div>
```

Replace with:

```html
<!-- Column 1: Projects -->
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

- [ ] **Step 7.2: Append CSS to `components.css`**

Append to the end of `csm/public/css/components.css`:

```css
/* ─── Project list toolbar (filter + sort) ──────────── */

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
  animation: csm-pulse 1.6s ease-in-out infinite;
}
@keyframes csm-pulse {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}
```

- [ ] **Step 7.3: Smoke-test layout**

Start the server and load the dashboard in a browser:

```bash
node csm/src/index.js --web --dev
```

Open `http://localhost:9847`. Verify:
- Toolbar appears below "Projects" header.
- Filter input fills available width; sort dropdown is to the right.
- Sort dropdown has 3 options (Recent / Added / Name).
- Activity indicator dot is hidden initially.
- Existing project items render below the toolbar with no layout breakage.

Stop the server.

- [ ] **Step 7.4: Commit**

```bash
git add csm/public/index.html csm/public/css/components.css
git commit -m "Add project list toolbar with filter input and sort selector"
```

---

## Task 8: Frontend — Snapshot rebuild + filter rendering + handlers

**Files:**
- Modify: `csm/public/js/render.js`
- Modify: `csm/public/js/actions.js`

- [ ] **Step 8.1: Add `rebuildProjectSnapshot()` to `render.js`**

In `csm/public/js/render.js`, immediately after the `wouldReorder()` function (added in Task 6), add:

```js
function rebuildProjectSnapshot() {
  State.projectListSnapshot = sortProjects(State.sessions, State.projectSort);
  State.hasNewActivity = false;
}
```

- [ ] **Step 8.2: Modify `renderProjects()` to use snapshot + filter + indicator**

In `csm/public/js/render.js`, find the existing `renderProjects()` (around line 81). Replace its body so it:
- Returns early on skeleton loading (existing behavior, unchanged).
- Lazily rebuilds the snapshot on the first call where `State.sessions` is non-empty.
- Filters the snapshot by `State.projectFilter` (case-insensitive substring on name).
- Renders an empty-state message scoped to whether the filter is active.
- Toggles the `#activityIndicator` visibility based on `State.hasNewActivity`.

The whole replacement:

```js
function renderProjects() {
  const list = el('projectList');

  if (State.loading) {
    list.innerHTML = Array.from({length: 3}, () =>
      '<div class="skeleton-project"><div class="skeleton skeleton-dot"></div><div style="flex:1"><div class="skeleton skeleton-line w60"></div></div></div>'
    ).join('');
    return;
  }

  // Lazy snapshot init.
  if (
    State.projectListSnapshot.length === 0 &&
    Object.keys(State.sessions).length > 0
  ) {
    rebuildProjectSnapshot();
  }

  // Toggle activity indicator.
  const ind = el('activityIndicator');
  if (ind) ind.style.display = State.hasNewActivity ? '' : 'none';

  // Filter snapshot.
  const filter = State.projectFilter.trim().toLowerCase();
  const visible = filter
    ? State.projectListSnapshot.filter(name => name.toLowerCase().includes(filter))
    : State.projectListSnapshot;

  if (visible.length === 0) {
    if (Object.keys(State.sessions).length === 0) {
      list.innerHTML = '<div class="empty-msg">No projects yet.<br>Click + to create one.</div>';
    } else {
      list.innerHTML = '<div class="empty-msg">No projects match the filter.</div>';
    }
    return;
  }

  list.innerHTML = visible.map(name => {
    const s = State.sessions[name];
    if (!s) return '';   // snapshot may briefly hold a removed name; skip silently
    const active = State.selected === name ? 'active' : '';
    let tokenHtml = '';
    if (s.tokens?.percentage != null) {
      const lvl = s.tokens.percentage >= 80 ? 'high' : s.tokens.percentage >= 60 ? 'med' : 'low';
      tokenHtml = `<div class="token-mini"><div class="token-mini-bar"><div class="token-mini-fill ${lvl}" style="width:${s.tokens.percentage}%"></div></div>${s.tokens.percentage}%</div>`;
    }
    const planning = State.planningProjects.has(name);
    const planDot = planning ? '<div class="planning-dot" title="AI Planning in progress"></div>' : '';

    const tc = State.taskCounts[name];
    const hasRunningTasks = tc && tc.running > 0;
    const hasPendingWork = tc && (tc.pending > 0 || tc.running > 0 || (tc.merge_pending || 0) > 0);
    const allDone = tc && tc.total > 0 && tc.completed === tc.total;
    const statusDotClass = hasRunningTasks ? 'working'
      : hasPendingWork ? s.status
      : s.status;

    let progressHtml = '';
    if (tc && tc.total > 0) {
      const pct = (count) => ((count / tc.total) * 100).toFixed(1);
      const mp = tc.merge_pending || 0;
      const tooltip = `${tc.completed}c ${tc.running}r ${tc.pending}p${mp ? ' ' + mp + 'm' : ''}${tc.failed ? ' ' + tc.failed + 'f' : ''} (${tc.completed}/${tc.total})`;
      progressHtml = `<div class="task-progress-bar" title="${tooltip}">`;
      if (tc.completed) progressHtml += `<div class="task-progress-segment completed" style="width:${pct(tc.completed)}%"></div>`;
      if (mp) progressHtml += `<div class="task-progress-segment merge-pending" style="width:${pct(mp)}%"></div>`;
      if (tc.running) progressHtml += `<div class="task-progress-segment running" style="width:${pct(tc.running)}%"></div>`;
      if (tc.pending) progressHtml += `<div class="task-progress-segment pending" style="width:${pct(tc.pending)}%"></div>`;
      if (tc.failed) progressHtml += `<div class="task-progress-segment failed" style="width:${pct(tc.failed)}%"></div>`;
      progressHtml += `</div>`;
    }

    return `
      <div class="project-item ${active}" onclick="selectProject('${escJs(name)}')" oncontextmenu="showProjectCtxMenu(event, '${escJs(name)}')">
        <div class="status-dot ${statusDotClass}"></div>
        <div class="project-info">
          <div class="project-name">${esc(name)}${planDot}</div>
          ${progressHtml}
        </div>
        ${tokenHtml}
        <button class="btn sm danger project-del" onclick="event.stopPropagation(); deleteProject('${escJs(name)}')" title="Delete project">&times;</button>
      </div>
    `;
  }).join('');
}
```

(The per-item template is unchanged from the current implementation — only the wrapping logic is new.)

- [ ] **Step 8.3: Add three handlers to `actions.js`**

Append to the end of `csm/public/js/actions.js`:

```js
// ─── Project list filter / sort ──────────────────────

function onProjectFilterInput(e) {
  State.projectFilter = e.target.value;
  renderProjects();
}

function onProjectSortChange(value) {
  State.projectSort = value;
  try { localStorage.setItem('csm.projectSort', value); } catch {}
  rebuildProjectSnapshot();
  renderProjects();
}

function onActivityIndicatorClick() {
  rebuildProjectSnapshot();
  renderProjects();
}
```

- [ ] **Step 8.4: Smoke-test filter and sort**

Start the server, open the dashboard. With at least 2 sessions:
- Type a partial name in the filter — non-matching projects disappear; clear the input — they reappear.
- Switch sort to "Name" — list reorders alphabetically. Reload (F5) — list comes back in name order (persisted).
- Switch sort to "Added" — list reorders by creation time (newest on top).
- Switch back to "Recent" — list reorders by `lastActivityAt`.
- Reload page; verify sort is restored from localStorage.

Stop the server.

- [ ] **Step 8.5: Commit**

```bash
git add csm/public/js/render.js csm/public/js/actions.js
git commit -m "Wire snapshot-based render with filter and sort handlers"
```

---

## Task 9: Frontend — WebSocket activity bump + snapshot rebuild on add/remove

**Files:**
- Modify: `csm/public/js/websocket.js`

- [ ] **Step 9.1: Handle `state` and `update` cases**

In `csm/public/js/websocket.js`, find the `case 'state':` block (lines 8-13):

```js
case 'state':
  State.sessions = msg.data;
  State.loading = false;
  renderProjects();
  loadAllTaskCounts();
  break;
```

Replace with:

```js
case 'state':
  State.sessions = msg.data;
  State.loading = false;
  rebuildProjectSnapshot();
  renderProjects();
  loadAllTaskCounts();
  break;
```

Find the `case 'update':` block (lines 15-19):

```js
case 'update':
  State.sessions[msg.data.name] = msg.data.session;
  renderProjects();
  if (State.selected === msg.data.name) renderTerminal();
  break;
```

Replace with:

```js
case 'update': {
  const wasInSnapshot = State.projectListSnapshot.includes(msg.data.name);
  State.sessions[msg.data.name] = msg.data.session;
  // New session appearing → rebuild so it shows up under current sort.
  if (!wasInSnapshot) rebuildProjectSnapshot();
  renderProjects();
  if (State.selected === msg.data.name) renderTerminal();
  break;
}
```

- [ ] **Step 9.2: Add `activityBump` handler**

In the same `switch` statement, add a new case (any reasonable place, e.g. after `case 'statusChange':`):

```js
case 'activityBump': {
  const { name, lastActivityAt } = msg.data;
  if (State.sessions[name]) {
    State.sessions[name].lastActivityAt = lastActivityAt;
  }
  if (
    State.projectSort === 'activity' &&
    wouldReorder(name, lastActivityAt, State.projectListSnapshot, State.sessions)
  ) {
    State.hasNewActivity = true;
  }
  renderProjects();
  break;
}
```

- [ ] **Step 9.3: Handle session removal in REST init path**

In `csm/public/index.html`, find the init script line:

```js
API.getSessions().then(d => { State.sessions = d; renderProjects(); loadAllTaskCounts(); }).catch(err => handleApiError(err, 'init'));
```

Replace with:

```js
API.getSessions().then(d => { State.sessions = d; rebuildProjectSnapshot(); renderProjects(); loadAllTaskCounts(); }).catch(err => handleApiError(err, 'init'));
```

Also, find the existing `connectWS();` call (immediately above) — leave it as-is. We need to ensure the sort dropdown reflects `State.projectSort` after DOM is parsed. Add this line at the very top of the inline `<script>` block in `index.html`, before `connectWS();`:

```js
const _sortSelect = document.getElementById('projectSortSelect');
if (_sortSelect) _sortSelect.value = State.projectSort;
```

- [ ] **Step 9.4: Rebuild snapshot in `deleteProject()`**

In `csm/public/js/actions.js`, find `deleteProject(name)` (around line 781). The existing implementation already refetches sessions and re-renders. Add a snapshot rebuild between them.

Find:

```js
const d = await API.getSessions();
State.sessions = d;
renderProjects();
```

Replace with:

```js
const d = await API.getSessions();
State.sessions = d;
rebuildProjectSnapshot();
renderProjects();
```

- [ ] **Step 9.5: Smoke-test live behavior**

Start server, open dashboard with at least 3 sessions:
- Verify default sort = Recent; the most recently active project is on top.
- Trigger activity in a non-top project (e.g. send a command via the existing UI). Observe the activity indicator (●) appear next to the sort dropdown. Order does not change.
- Click the indicator — the project moves to top; indicator disappears.
- Switch sort to "Name". Trigger activity again — indicator does NOT appear (sort is not by activity).
- Switch sort to "Recent". Trigger activity in the project already on top — indicator does NOT appear.
- Create a new session via the `+` button — it appears (at top under Recent sort) without manual reload.
- Delete a session via its `×` button — it disappears immediately and the snapshot rebuilds.

Stop the server.

- [ ] **Step 9.6: Commit**

```bash
git add csm/public/js/websocket.js csm/public/js/actions.js csm/public/index.html
git commit -m "Wire WebSocket activityBump and snapshot rebuilds on add/remove"
```

---

## Task 10: Final verification — full manual checklist

**Files:** none (this task is verification only).

- [ ] **Step 10.1: Run all unit tests**

```bash
node csm/test/detector.test.js
node csm/test/history-activity.test.js
node csm/test/sort-projects.test.js
```

Expected: every script ends with `N passed, 0 failed` and exit code 0.

- [ ] **Step 10.2: Walk the spec test plan**

Open `docs/superpowers/specs/2026-04-28-project-list-search-sort-design.md`. Run through every checkbox in the "Manual checklist" section against the running dashboard. Specifically confirm:

**Backend / DB:**
- [ ] Fresh install: starting the server with no `session_activity` table creates it and backfills config sessions in array order (older config positions get older synthesized timestamps).
- [ ] Rerun: existing rows are not overwritten on second startup.
- [ ] Each of the 7 trigger endpoints (sessions: send/keys/terminal/restart/recreate-tmux/create, tasks: send/keys; pipeline: wishes POST, execute-interactive/silent/execute) bumps `lastActivityAt`.
- [ ] `/api/sessions/:name/focus` does NOT bump (negative test — focus a project, then read `/api/sessions` and confirm `lastActivityAt` did not change).
- [ ] Session deletion (`/kill` and `/destroy`) removes the `session_activity` row (verify with `sqlite3 ~/.csm/history.db "SELECT * FROM session_activity"`).

**Frontend / UI:**
- [ ] Toolbar renders correctly under the header.
- [ ] Default sort = Recent on first load.
- [ ] Each of the 3 sort modes produces the expected order.
- [ ] localStorage persists `projectSort` across reloads.
- [ ] `projectFilter` is empty after reload.
- [ ] Filter is case-insensitive substring on name.
- [ ] Selected project filtered out: selection preserved (wishes/tasks columns keep rendering); clearing filter restores highlight.

**C3 indicator:**
- [ ] Activity in non-top project + sort=activity → indicator appears.
- [ ] Click indicator → re-sort, indicator hides.
- [ ] Activity in top project → indicator does NOT appear.
- [ ] Activity while sort = Name or Added → indicator does NOT appear.

**Regressions:**
- [ ] All existing project-item interactions work: click-select, right-click context menu, delete `×`, status dot, token bar, task progress bar, planning dot.
- [ ] WS `update`/`statusChange`: live updates of status and tokens render without changing project order.
- [ ] Skeleton loading still appears on first connect.

- [ ] **Step 10.3: Final commit if any tweaks were needed**

If any spec test revealed a bug fixed in this verification round, commit it:

```bash
git add -A
git commit -m "Address regressions found during final verification"
```

If everything passed without changes, no final commit is needed.

---

## Out of scope (do not implement here)

- Hotkey to focus filter (deferred — d1).
- Persisting filter text across reloads (deferred — c1).
- Fuzzy matching.
- Pagination / virtualization (>100 projects).
- Server-side activity aggregation API.
- Per-project trend indicators.
- Project grouping or folders.
