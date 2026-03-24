/**
 * Tests for detector.js — status detection from tmux pane output.
 *
 * Run: node csm/test/detector.test.js
 */
const { detectStatus, Status } = require('../src/lib/detector');

let passed = 0;
let failed = 0;

function assert(name, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

// Helper: build fake pane output with N filler lines then the given last lines
function pane(lastLines, fillerCount = 30) {
  const filler = Array(fillerCount).fill('some old output line').join('\n');
  return filler + '\n' + lastLines;
}

// ─── Bug fix: ✻ in completion summary should NOT trigger working ───

assert(
  'completion summary "✻ Cogitated for 56s" with prompt → needs_input',
  detectStatus(pane([
    '✻ Cogitated for 56s',
    '',
    'Here is the result of the analysis.',
    '',
    '❯ ',
  ].join('\n'))).status,
  Status.NEEDS_INPUT,
);

assert(
  'completion summary "✻ Baked for 2m 48s" with prompt → needs_input',
  detectStatus(pane([
    '✻ Baked for 2m 48s',
    'Done. Created 3 files.',
    '',
    '❯ ',
  ].join('\n'))).status,
  Status.NEEDS_INPUT,
);

// ─── Bug fix: stale "Running", "Writing" etc. above prompt ───

assert(
  'stale "Running bash" 10 lines above prompt → needs_input',
  detectStatus(pane([
    'Running bash command: npm test',
    '  PASS src/test.js',
    '  Tests: 5 passed',
    '',
    'All tests passed.',
    '',
    '✻ Took 12s',
    '',
    'I ran the tests and they all pass.',
    '',
    '❯ ',
  ].join('\n'))).status,
  Status.NEEDS_INPUT,
);

assert(
  'stale "Writing file" above prompt → needs_input',
  detectStatus(pane([
    'Writing file: src/index.js',
    'Edit applied successfully.',
    '',
    'I updated the file.',
    '',
    '❯ ',
  ].join('\n'))).status,
  Status.NEEDS_INPUT,
);

assert(
  'stale "Reading file" above prompt → needs_input',
  detectStatus(pane([
    'Reading file: src/lib/config.js',
    '',
    'The config module exports the following...',
    '',
    '❯ ',
  ].join('\n'))).status,
  Status.NEEDS_INPUT,
);

// ─── Active working should still be detected ───

assert(
  'active spinner ✻ (no completion text) → working',
  detectStatus(pane([
    '',
    '✻ ',
    '',
  ].join('\n'))).status,
  Status.WORKING,
);

assert(
  'active spinner ⠋ → working',
  detectStatus(pane([
    '',
    '⠋ Thinking...',
    '',
  ].join('\n'))).status,
  Status.WORKING,
);

assert(
  'hourglass ⏳ → working',
  detectStatus(pane([
    '',
    '⏳ Processing...',
    '',
  ].join('\n'))).status,
  Status.WORKING,
);

assert(
  '"Thinking" on last line → working',
  detectStatus(pane([
    '',
    'Thinking about your request...',
    '',
  ].join('\n'))).status,
  Status.WORKING,
);

// ─── Prompt detection ───

assert(
  'bare ❯ prompt → needs_input',
  detectStatus(pane('❯ ')).status,
  Status.NEEDS_INPUT,
);

assert(
  'shell $ prompt → needs_input',
  detectStatus(pane('user@host:~$ ')).status,
  Status.NEEDS_INPUT,
);

assert(
  'y/n prompt → needs_input',
  detectStatus(pane('Do you want to continue? (y/n)')).status,
  Status.NEEDS_INPUT,
);

// ─── Error detection ───

assert(
  'Error in recent output → error',
  detectStatus(pane([
    'Error: ENOENT no such file',
    '',
  ].join('\n'))).status,
  Status.ERROR,
);

assert(
  'rate limit → error',
  detectStatus(pane('rate limit exceeded, retrying in 30s')).status,
  Status.ERROR,
);

// ─── Idle / Offline ───

assert(
  'empty output → offline',
  detectStatus('').status,
  Status.OFFLINE,
);

assert(
  'null output → offline',
  detectStatus(null).status,
  Status.OFFLINE,
);

assert(
  'generic text, no indicators → idle',
  detectStatus(pane('some random log output here')).status,
  Status.IDLE,
);

// ─── Welcome screen ───

assert(
  'welcome screen with ❯ → needs_input',
  detectStatus('Welcome to Claude Code!\n\n? for shortcuts\n\n\n\n\n\n\n\n\n\n\n\n❯ ').status,
  Status.NEEDS_INPUT,
);

// ─── Real-world regression: prompt at bottom with ✻ summary further up ───

assert(
  'real-world: Posty session with ✻ Cogitated + ❯ prompt at end',
  detectStatus(pane([
    '  ✻ Cogitated for 1m 23s',
    '',
    'I\'ve analyzed the codebase and here are my findings:',
    '- The API endpoints are correctly configured',
    '- Database migrations are up to date',
    '',
    'Let me know if you need anything else.',
    '',
    '❯ ',
  ].join('\n'))).status,
  Status.NEEDS_INPUT,
);

// ─── Bug fix: "Running task..." should NOT trigger WORKING ───

assert(
  '"Running task-34..." in output with prompt → needs_input (not working)',
  detectStatus(pane([
    'Running task-34: Fix detector patterns',
    'Task completed successfully.',
    '',
    '❯ ',
  ].join('\n'))).status,
  Status.NEEDS_INPUT,
);

assert(
  '"Running task" without tool context should not trigger working',
  detectStatus(pane([
    'Running task analysis...',
    'Done.',
    '',
    '',
    '',
  ].join('\n'))).status,
  Status.IDLE,
);

// ─── Bug fix: prompt on line 4-5 should be detected (was only 3 lines) ───

assert(
  'prompt on 4th line from bottom → needs_input',
  detectStatus(pane([
    '❯ ',
    '',
    '',
    '',
  ].join('\n'))).status,
  Status.NEEDS_INPUT,
);

assert(
  'prompt on 5th line from bottom → needs_input',
  detectStatus(pane([
    '❯ ',
    '',
    '',
    '',
    '',
  ].join('\n'))).status,
  Status.NEEDS_INPUT,
);

// ─── zsh % prompt ───

assert(
  'zsh % prompt → needs_input',
  detectStatus(pane('user@host% ')).status,
  Status.NEEDS_INPUT,
);

// ─── Claude Code permission prompts ───

assert(
  'Allow Read? permission prompt → needs_input',
  detectStatus(pane([
    'Allow Read to /src/index.js?',
    '',
  ].join('\n'))).status,
  Status.NEEDS_INPUT,
);

assert(
  'Do you want to proceed? → needs_input',
  detectStatus(pane([
    'Do you want to proceed with these changes?',
    '',
  ].join('\n'))).status,
  Status.NEEDS_INPUT,
);

// ─── "Running bash command" SHOULD still trigger working (tool use) ───

assert(
  '"Running bash command" (tool use) → working',
  detectStatus(pane([
    '',
    '  Running bash command: npm test',
    '',
  ].join('\n'))).status,
  Status.WORKING,
);

assert(
  '"Running command" with ⎿ prefix → working',
  detectStatus(pane([
    '',
    '  ⎿ Running command: git status',
    '',
  ].join('\n'))).status,
  Status.WORKING,
);

// ─── Summary ───

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
