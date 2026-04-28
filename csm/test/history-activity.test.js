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
