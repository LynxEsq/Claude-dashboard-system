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
// Vendor browser globals normally loaded via <script> tags — stub minimally so
// render.js can be required in Node without DOM/browser libs.
global.AnsiUp = function () { this.escape_html = false; this.ansi_to_html = (s) => s || ''; };
global.marked = { parse: (s) => s || '' };
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
