/**
 * Pipeline: Inbox → Tasks → Execution
 *
 * Flow:
 * 1. User writes "wishes" (хочухи) into Inbox for a project session
 * 2. When execution finishes (session goes idle), heartbeat triggers processing
 * 3. AI (Claude) is launched to convert unprocessed wishes → Tasks
 *    - Multiple wishes can become one task (if related)
 *    - One wish can become multiple tasks (if different areas)
 *    - AI receives both raw wishes AND draft tasks to mix/augment
 * 4. Tasks execute one-by-one, each as a separate Claude session
 * 5. Wishes are marked "processed" after task creation
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const tmux = require('./tmux');
const config = require('./config');
const { openDatabase, cleanAnsi } = require('./utils');

let db = null;

function getDb() {
  if (db) return db;
  db = openDatabase('pipeline.db', { foreignKeys: false });
  initTables();
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wishes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_name TEXT NOT NULL,
      content TEXT NOT NULL,
      processed INTEGER DEFAULT 0,
      task_ids TEXT,
      created_at DATETIME DEFAULT (datetime('now')),
      processed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      wish_ids TEXT,
      status TEXT DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      execution_log TEXT,
      created_at DATETIME DEFAULT (datetime('now')),
      started_at DATETIME,
      completed_at DATETIME,
      updated_at DATETIME,
      type TEXT DEFAULT 'task',
      result TEXT
    );

    CREATE TABLE IF NOT EXISTS execution_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      session_name TEXT NOT NULL,
      tmux_session TEXT,
      status TEXT DEFAULT 'running',
      output_summary TEXT,
      started_at DATETIME DEFAULT (datetime('now')),
      completed_at DATETIME,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_wishes_session
      ON wishes(session_name, processed);
    CREATE INDEX IF NOT EXISTS idx_tasks_session
      ON tasks(session_name, status);
  `);

  // Migrations: add columns if missing (existing databases)
  try {
    const cols = db.prepare("PRAGMA table_info(tasks)").all().map(c => c.name);
    if (!cols.includes('updated_at')) {
      db.exec("ALTER TABLE tasks ADD COLUMN updated_at DATETIME");
    }
    if (!cols.includes('type')) {
      db.exec("ALTER TABLE tasks ADD COLUMN type TEXT DEFAULT 'task'");
    }
    if (!cols.includes('result')) {
      db.exec("ALTER TABLE tasks ADD COLUMN result TEXT");
    }
  } catch {}
}

// ─── Wishes (Inbox) ────────────────────────────────────

function addWish(sessionName, content) {
  const stmt = getDb().prepare(`
    INSERT INTO wishes (session_name, content) VALUES (?, ?)
  `);
  const result = stmt.run(sessionName, content);
  return result.lastInsertRowid;
}

function getUnprocessedWishes(sessionName) {
  return getDb().prepare(`
    SELECT * FROM wishes
    WHERE session_name = ? AND processed = 0
    ORDER BY created_at ASC
  `).all(sessionName);
}

function getAllWishes(sessionName, limit = 50) {
  return getDb().prepare(`
    SELECT * FROM wishes
    WHERE session_name = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(sessionName, limit);
}

function updateWish(id, content) {
  getDb().prepare('UPDATE wishes SET content = ? WHERE id = ?').run(content, id);
}

function deleteWish(id) {
  getDb().prepare('DELETE FROM wishes WHERE id = ?').run(id);
}

function markWishesProcessed(wishIds, taskIds) {
  const stmt = getDb().prepare(`
    UPDATE wishes
    SET processed = 1, processed_at = datetime('now'), task_ids = ?
    WHERE id = ?
  `);
  const taskIdsStr = JSON.stringify(taskIds);
  for (const id of wishIds) {
    stmt.run(taskIdsStr, id);
  }
}

// ─── Tasks ─────────────────────────────────────────────

function createTask(sessionName, title, description, wishIds = [], priority = 0) {
  const stmt = getDb().prepare(`
    INSERT INTO tasks (session_name, title, description, wish_ids, priority)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(sessionName, title, description, JSON.stringify(wishIds), priority);
  return result.lastInsertRowid;
}

function updateTask(id, fields) {
  const allowed = ['title', 'description', 'priority', 'status', 'type', 'result'];
  const sets = [];
  const values = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) { sets.push(`${k} = ?`); values.push(v); }
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = datetime('now')`);
  values.push(id);
  getDb().prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function deleteTask(id) {
  getDb().prepare('DELETE FROM execution_log WHERE task_id = ?').run(id);
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

function getTasks(sessionName, status = null) {
  if (status) {
    return getDb().prepare(`
      SELECT * FROM tasks
      WHERE session_name = ? AND status = ?
      ORDER BY priority DESC, created_at ASC
    `).all(sessionName, status);
  }
  return getDb().prepare(`
    SELECT * FROM tasks
    WHERE session_name = ?
    ORDER BY
      CASE status
        WHEN 'running' THEN 0
        WHEN 'pending' THEN 1
        WHEN 'completed' THEN 2
        WHEN 'failed' THEN 3
      END,
      priority DESC, created_at ASC
  `).all(sessionName);
}

function getAllTasks(limit = 100) {
  return getDb().prepare(`
    SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

function updateTaskStatus(taskId, status, outputSummary = null) {
  const updates = { status };
  if (status === 'running') updates.started_at = new Date().toISOString();
  if (status === 'completed' || status === 'failed') updates.completed_at = new Date().toISOString();
  if (outputSummary) updates.execution_log = outputSummary;

  const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ') + `, updated_at = datetime('now')`;
  const values = Object.values(updates);

  getDb().prepare(`UPDATE tasks SET ${setClause} WHERE id = ?`).run(...values, taskId);
}

function getNextPendingTask(sessionName) {
  return getDb().prepare(`
    SELECT * FROM tasks
    WHERE session_name = ? AND status = 'pending'
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `).all(sessionName)[0] || null;
}

function hasRunningTask(sessionName) {
  const row = getDb().prepare(`
    SELECT COUNT(*) as cnt FROM tasks
    WHERE session_name = ? AND status = 'running'
  `).get(sessionName);
  return row.cnt > 0;
}

// ─── Execution ─────────────────────────────────────────

function logExecution(taskId, sessionName, tmuxSession) {
  const stmt = getDb().prepare(`
    INSERT INTO execution_log (task_id, session_name, tmux_session)
    VALUES (?, ?, ?)
  `);
  return stmt.run(taskId, sessionName, tmuxSession).lastInsertRowid;
}

function completeExecution(execId, status, outputSummary) {
  getDb().prepare(`
    UPDATE execution_log
    SET status = ?, output_summary = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(status, outputSummary, execId);
}

function getExecutionLog(sessionName, limit = 20) {
  return getDb().prepare(`
    SELECT e.*, t.title as task_title
    FROM execution_log e
    JOIN tasks t ON e.task_id = t.id
    WHERE e.session_name = ?
    ORDER BY e.started_at DESC
    LIMIT ?
  `).all(sessionName, limit);
}

// ─── Task Planning (AI Integration) ────────────────────

/**
 * Generate a prompt for Claude to convert wishes into tasks.
 * This prompt is sent to a separate Claude session for planning.
 */
function generatePlanningPrompt(sessionName, wishes, existingTasks) {
  const wishList = wishes.map((w, i) =>
    `${i + 1}. [wish-${w.id}] ${w.content}`
  ).join('\n');

  const pendingTasks = existingTasks
    .filter(t => t.status === 'pending')
    .map((t, i) => `${i + 1}. [task-${t.id}] ${t.title}: ${t.description}`)
    .join('\n');

  return `You are a task planner for the project session "${sessionName}".

## New Wishes (unprocessed inbox items from the user):
${wishList}

${pendingTasks ? `## Existing Pending Tasks (already created, DO NOT duplicate):
${pendingTasks}
` : ''}

## Your Job:
Convert the NEW wishes into actionable tasks. CRITICAL RULES:

1. Each task must be a single, focused unit of work that Claude Code can complete in ONE session
2. Multiple related wishes can become ONE task
3. One complex wish can become MULTIPLE tasks
4. Task description must be detailed enough for Claude Code to execute independently

## HANDLING EXISTING TASKS — VERY IMPORTANT:
- If a new wish overlaps with an existing task, use "action": "update" with the existing task's "existing_id" to MERGE them — do NOT create a duplicate
- If an existing task should be removed (replaced by a better version), use "action": "delete" with "existing_id"
- If an existing task's priority should change, use "action": "update" with new priority
- For brand new tasks, use "action": "create"
- Return ALL actions needed: creates, updates, and deletes

## Output Format:
Return a JSON object with this structure:
{
  "tasks": [ ... ],   // array of task actions (can be empty)
  "summary": "..."    // brief explanation of what was planned (always required)
}

Each item in "tasks" array:
{
  "action": "create" | "update" | "delete",
  "existing_id": null,          // for "update"/"delete": the [task-ID] number from existing tasks
  "title": "Short task title",  // for "create"/"update"
  "description": "Detailed description",  // for "create"/"update"
  "wish_ids": [4, 5],           // IDs of NEW wishes this addresses
  "priority": 0-10              // higher = more urgent
}

If no new tasks are needed (e.g. wishes are questions, already covered by existing tasks, or just recommendations), return:
{
  "tasks": [],
  "summary": "Clear explanation for the user why no tasks were created and what is recommended"
}

Return ONLY the JSON object, no markdown, no explanation.`;
}

/**
 * Execute the next pending task for a session.
 * Creates a temporary tmux session, runs Claude with the task prompt, monitors completion.
 */
function executeNextTask(sessionName) {
  if (hasRunningTask(sessionName)) {
    return { started: false, reason: 'A task is already running' };
  }

  const task = getNextPendingTask(sessionName);
  if (!task) {
    return { started: false, reason: 'No pending tasks' };
  }

  // Get the existing session config
  const sessConfig = config.findSession(sessionName);
  if (!sessConfig) {
    return { started: false, reason: 'Session not found in config' };
  }

  // Check that tmux session exists
  if (!tmux.sessionExists(sessConfig.tmuxSession)) {
    return { started: false, reason: 'tmux session not found — is it running?' };
  }

  // Mark task as running
  updateTaskStatus(task.id, 'running');

  // Log execution
  const execId = logExecution(task.id, sessionName, sessConfig.tmuxSession);

  // Send task description directly to the existing Claude session
  const prompt = task.description;
  tmux.sendText(sessConfig.tmuxSession, sessConfig.tmuxWindow, sessConfig.tmuxPane, prompt);

  return {
    started: true,
    taskId: task.id,
    execId,
    tmuxSession: sessConfig.tmuxSession,
  };
}

// Track active task executions (both interactive and silent): taskId -> { tmuxSession, outputFile, sessionName, mode }
const activeExecs = new Map();

/**
 * Execute a task interactively: create a tmux session, start Claude, paste the prompt.
 */
function executeTaskInteractive(sessionName, taskId) {
  if (activeExecs.has(taskId)) {
    return { started: false, reason: 'Task already executing', tmuxSession: activeExecs.get(taskId).tmuxSession };
  }

  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return { started: false, reason: 'Task not found' };
  if (task.status !== 'pending') return { started: false, reason: 'Task is not pending' };

  const sessConfig = config.findSession(sessionName);
  const projectPath = sessConfig?.projectPath || null;

  let cwd = os.homedir();
  if (projectPath && fs.existsSync(projectPath)) cwd = projectPath;

  // Verify claude CLI is available
  findClaudeBin();

  const safeName = tmux.safeTmuxName(sessionName);
  const execTmux = `csm-task-${safeName}-${taskId}`;

  tmux.killSession(execTmux);
  const result = tmux.createSession(execTmux, cwd, true); // startClaude = true
  if (!result.success) {
    return { started: false, reason: 'Cannot create session: ' + result.error };
  }

  // Write prompt to file for reliable paste
  const promptFile = path.join(os.tmpdir(), `csm-task-prompt-${safeName}-${taskId}.txt`);
  fs.writeFileSync(promptFile, task.description);

  // Wait for Claude to start, then paste prompt
  setTimeout(() => {
    try {
      execSync(`tmux load-buffer "${promptFile}"`, { timeout: 5000 });
      execSync(`tmux paste-buffer -t "${execTmux}"`, { timeout: 5000 });
      setTimeout(() => {
        try {
          execSync(`tmux send-keys -t "${execTmux}" Enter`, { timeout: 5000 });
        } catch {}
      }, 1000);
    } catch (e) {
      console.error('[Task] Failed to send prompt:', e.message);
    }
  }, 5000);

  updateTaskStatus(taskId, 'running');
  const execId = logExecution(taskId, sessionName, execTmux);

  activeExecs.set(taskId, {
    tmuxSession: execTmux,
    sessionName,
    execId,
    mode: 'interactive',
    startedAt: Date.now(),
  });

  return { started: true, taskId, execId, tmuxSession: execTmux };
}

/**
 * Execute a specific task silently with --print in a visible tmux session.
 */
function executeTaskSilent(sessionName, taskId) {
  if (activeExecs.has(taskId)) {
    return { started: false, reason: 'Task already executing', tmuxSession: activeExecs.get(taskId).tmuxSession };
  }

  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return { started: false, reason: 'Task not found' };
  if (task.status !== 'pending') return { started: false, reason: 'Task is not pending' };

  const sessConfig = config.findSession(sessionName);
  const projectPath = sessConfig?.projectPath || null;

  let cwd = os.homedir();
  if (projectPath && fs.existsSync(projectPath)) cwd = projectPath;

  const safeName = tmux.safeTmuxName(sessionName);
  const execTmux = `csm-exec-${safeName}-${taskId}`;
  const ts = Date.now();
  const promptFile = path.join(os.tmpdir(), `csm-exec-prompt-${safeName}-${taskId}-${ts}.txt`);
  const outputFile = path.join(os.tmpdir(), `csm-exec-output-${safeName}-${taskId}-${ts}.txt`);
  const scriptFile = path.join(os.tmpdir(), `csm-exec-run-${safeName}-${taskId}-${ts}.sh`);

  fs.writeFileSync(promptFile, task.description);

  // Verify claude CLI is available before creating sessions
  const claudeBin = findClaudeBin();

  tmux.killSession(execTmux);
  const result = tmux.createSession(execTmux, cwd, false);
  if (!result.success) {
    return { started: false, reason: 'Cannot create exec session: ' + result.error };
  }
  fs.writeFileSync(scriptFile, [
    '#!/bin/bash',
    `echo "=== Executing task: ${task.title.replace(/"/g, '\\"')} ==="`,
    `echo ""`,
    `cat "${promptFile}" | "${claudeBin}" --print --no-session-persistence 2>&1 | tee "${outputFile}"`,
    `echo ""`,
    `echo "___CSM_EXEC_DONE___" >> "${outputFile}"`,
    `echo ""`,
    `echo "=== Task complete ==="`,
  ].join('\n'));
  fs.chmodSync(scriptFile, '755');

  try {
    execSync(`tmux send-keys -t "${execTmux}" 'bash ${scriptFile}' Enter`, { timeout: 5000 });
  } catch (err) {
    tmux.killSession(execTmux);
    throw new PipelineError(
      'Не удалось запустить задачу в tmux сессии: ' + err.message,
      'TMUX_SEND_FAILED'
    );
  }

  updateTaskStatus(taskId, 'running');
  const execId = logExecution(taskId, sessionName, execTmux);

  activeExecs.set(taskId, {
    tmuxSession: execTmux,
    outputFile,
    promptFile,
    scriptFile,
    sessionName,
    execId,
    startedAt: Date.now(),
  });

  return { started: true, taskId, execId, tmuxSession: execTmux };
}

/**
 * Check task execution status (works for both interactive and silent modes).
 */
function getTaskExecStatus(sessionName, taskId) {
  const exec = activeExecs.get(taskId);
  if (!exec) {
    const task = getDb().prepare('SELECT status FROM tasks WHERE id = ?').get(taskId);
    return { status: task?.status || 'unknown' };
  }

  // Check if tmux session still exists
  if (!tmux.sessionExists(exec.tmuxSession)) {
    activeExecs.delete(taskId);
    return { status: 'unknown', reason: 'Session disappeared' };
  }

  // Interactive mode — show live pane; detect if Claude has finished (prompt visible)
  if (exec.mode === 'interactive') {
    const paneOutput = tmux.capturePane(exec.tmuxSession, null, null) || '';

    // Check if Claude returned to prompt (task likely finished)
    // Look for prompt chars on the last 3 lines
    const lastLines = paneOutput.split('\n').slice(-3).join('\n');
    const promptVisible = /❯/.test(lastLines) || /\$\s*$/.test(lastLines);

    // If prompt is visible and enough time has passed (>30s), mark as completed
    if (promptVisible && (Date.now() - exec.startedAt > 30000)) {
      const cleanOutput = cleanAnsi(paneOutput);
      updateTaskStatus(taskId, 'completed', cleanOutput.substring(cleanOutput.length - 2000));
      completeExecution(exec.execId, 'completed', cleanOutput.substring(cleanOutput.length - 2000));
      // Kill the tmux session now that the task is done
      tmux.killSession(exec.tmuxSession);
      activeExecs.delete(taskId);
      return {
        status: 'completed',
        mode: 'interactive',
        output: cleanOutput.substring(cleanOutput.length - 500),
      };
    }

    return {
      status: 'running',
      tmuxSession: exec.tmuxSession,
      mode: 'interactive',
      elapsed: Date.now() - exec.startedAt,
      preview: paneOutput,
    };
  }

  // Silent mode — check output file for done marker
  let output = '';
  try {
    output = fs.readFileSync(exec.outputFile, 'utf-8');
  } catch {
    return { status: 'running', tmuxSession: exec.tmuxSession, mode: 'silent', elapsed: Date.now() - exec.startedAt };
  }

  if (!output.includes('___CSM_EXEC_DONE___')) {
    const paneOutput = tmux.capturePane(exec.tmuxSession, null, null);
    return {
      status: 'running',
      tmuxSession: exec.tmuxSession,
      mode: 'silent',
      elapsed: Date.now() - exec.startedAt,
      preview: paneOutput || output.split('\n').slice(-20).join('\n'),
    };
  }

  // Silent done
  const cleanOutput = cleanAnsi(output.replace('___CSM_EXEC_DONE___', ''));
  updateTaskStatus(taskId, 'completed', cleanOutput.substring(0, 2000));
  completeExecution(exec.execId, 'completed', cleanOutput.substring(0, 2000));
  tmux.killSession(exec.tmuxSession);
  activeExecs.delete(taskId);

  return { status: 'completed', output: cleanOutput.substring(0, 500) };
}

// Track active planning sessions: sessionName -> { tmuxSession, promptFile, outputFile, wishIds }
const activePlans = new Map();

/**
 * Find the claude CLI binary path. Throws a user-friendly error if not found.
 */
function findClaudeBin() {
  try {
    return execSync('which claude', { encoding: 'utf-8', timeout: 5000 }).trim();
  } catch {
    throw new PipelineError(
      'Claude CLI не найден. Убедитесь, что claude установлен и доступен в PATH.\n' +
      'Установка: npm install -g @anthropic-ai/claude-code',
      'CLAUDE_NOT_FOUND'
    );
  }
}

/**
 * Custom error class for pipeline errors with error codes.
 */
class PipelineError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
  }
}

/**
 * Start planning: launch Claude in a visible tmux session.
 * User can attach to watch. Poll /plan/status for results.
 */
function planTasks(sessionName) {
  if (activePlans.has(sessionName)) {
    return { planned: false, reason: 'Planning already in progress', tmuxSession: activePlans.get(sessionName).tmuxSession };
  }

  const wishes = getUnprocessedWishes(sessionName);
  if (wishes.length === 0) {
    return { planned: false, reason: 'No unprocessed wishes' };
  }

  const existingTasks = getTasks(sessionName);
  const prompt = generatePlanningPrompt(sessionName, wishes, existingTasks);

  const sessConfig = config.findSession(sessionName);
  const projectPath = sessConfig?.projectPath || null;

  let cwd = os.homedir();
  if (projectPath && fs.existsSync(projectPath)) {
    cwd = projectPath;
  }

  // Verify claude CLI is available before creating sessions
  const claudeBin = findClaudeBin();

  const safeName = tmux.safeTmuxName(sessionName);
  const planTmux = `csm-plan-${safeName}`;
  const ts = Date.now();
  const promptFile = path.join(os.tmpdir(), `csm-plan-prompt-${safeName}-${ts}.txt`);
  const outputFile = path.join(os.tmpdir(), `csm-plan-output-${safeName}-${ts}.txt`);

  // Write prompt
  fs.writeFileSync(promptFile, prompt);

  // Kill old planning session if exists
  tmux.killSession(planTmux);

  // Create visible tmux session for planning
  const result = tmux.createSession(planTmux, cwd, false);
  if (!result.success) {
    return { planned: false, reason: 'Cannot create planning session: ' + result.error };
  }

  // Write a shell script: claude --print (non-interactive, no questions)
  // tee shows output in terminal so user can watch, result saved to file
  const scriptFile = path.join(os.tmpdir(), `csm-plan-run-${safeName}-${ts}.sh`);
  fs.writeFileSync(scriptFile, [
    '#!/bin/bash',
    `echo "=== CSM Planning: analyzing wishes... ==="`,
    `echo ""`,
    `cat "${promptFile}" | "${claudeBin}" --print --no-session-persistence 2>&1 | tee "${outputFile}"`,
    `echo ""`,
    `echo "___CSM_PLAN_DONE___" >> "${outputFile}"`,
    `echo ""`,
    `echo "=== Planning complete ==="`,
  ].join('\n'));
  fs.chmodSync(scriptFile, '755');

  // Run script in tmux session
  try {
    execSync(`tmux send-keys -t "${planTmux}" 'bash ${scriptFile}' Enter`, { timeout: 5000 });
  } catch (err) {
    tmux.killSession(planTmux);
    throw new PipelineError(
      'Не удалось запустить планирование в tmux сессии: ' + err.message,
      'TMUX_SEND_FAILED'
    );
  }

  // Create a plan-type task to track planning progress
  const wishSummary = wishes.map(w => w.content.substring(0, 80)).join('; ');
  const planTaskId = createTask(
    sessionName,
    `Planning: ${wishes.length} wish${wishes.length !== 1 ? 'es' : ''}`,
    `Analyzing wishes: ${wishSummary}`,
    wishes.map(w => w.id),
    0
  );
  // Set type to 'plan' and status to 'running'
  updateTask(planTaskId, { type: 'plan', status: 'running' });

  // Track
  activePlans.set(sessionName, {
    tmuxSession: planTmux,
    promptFile,
    outputFile,
    scriptFile,
    wishIds: wishes.map(w => w.id),
    planTaskId,
    startedAt: Date.now(),
  });

  return {
    planned: true,
    status: 'running',
    tmuxSession: planTmux,
    wishCount: wishes.length,
    planTaskId,
  };
}

/**
 * Check planning status by reading the output file.
 */
function getPlanStatus(sessionName) {
  const plan = activePlans.get(sessionName);
  if (!plan) {
    return { status: 'idle' };
  }

  const elapsed = Date.now() - plan.startedAt;

  // Read output file
  let output = '';
  try {
    output = fs.readFileSync(plan.outputFile, 'utf-8');
  } catch {
    // File not yet created — still starting
    return { status: 'running', tmuxSession: plan.tmuxSession, elapsed };
  }

  // Not done yet
  if (!output.includes('___CSM_PLAN_DONE___')) {
    const lines = output.split('\n').filter(l => l.trim());
    const preview = lines.slice(-3).join('\n');
    return { status: 'running', tmuxSession: plan.tmuxSession, elapsed, preview };
  }

  // Done! Parse result — strip ANSI escape codes and done marker
  const cleanOutput = cleanAnsi(output.replace('___CSM_PLAN_DONE___', ''));
  console.log('[Plan] Raw output length:', cleanOutput.length);
  console.log('[Plan] Raw output (last 300):', cleanOutput.substring(cleanOutput.length - 300));
  const tasksJson = extractJson(cleanOutput);

  // TODO: cleanup temp files after debugging
  // try { fs.unlinkSync(plan.promptFile); } catch {}
  // try { fs.unlinkSync(plan.outputFile); } catch {}
  // if (plan.scriptFile) try { fs.unlinkSync(plan.scriptFile); } catch {}

  if (!tasksJson) {
    // Don't kill session so user can inspect
    // Update plan-task as failed
    if (plan.planTaskId) {
      updateTask(plan.planTaskId, {
        status: 'failed',
        result: 'Claude did not return valid JSON. Raw: ' + cleanOutput.substring(cleanOutput.length - 500),
      });
    }
    activePlans.delete(sessionName);
    return { status: 'error', reason: 'Claude did not return valid JSON', raw: cleanOutput.substring(cleanOutput.length - 500) };
  }

  tmux.killSession(plan.tmuxSession);
  activePlans.delete(sessionName);

  const result = applyPlan(sessionName, tasksJson, plan.wishIds, plan.planTaskId);
  return {
    status: 'done',
    ...result,
  };
}

/**
 * Extract a JSON array from Claude's response text.
 * Handles markdown code blocks, extra text before/after JSON, etc.
 */
function extractJson(text) {
  if (!text) return null;

  // Helper: accept both { tasks: [...], summary } object and plain [...] array
  function isValidPlanJson(parsed) {
    if (Array.isArray(parsed)) return true;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks)) return true;
    return false;
  }

  // Try to find JSON in code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (isValidPlanJson(parsed)) return codeBlockMatch[1].trim();
    } catch {}
  }

  // Try to find a JSON object with "tasks" key
  const objectMatch = text.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (isValidPlanJson(parsed)) return objectMatch[0];
    } catch {}
  }

  // Try to find a JSON array directly
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return arrayMatch[0];
    } catch {}
  }

  // Try the whole text
  try {
    const parsed = JSON.parse(text.trim());
    if (isValidPlanJson(parsed)) return text.trim();
  } catch {}

  return null;
}

/**
 * Apply planned tasks (after AI returns the JSON).
 */
function applyPlan(sessionName, tasksJson, wishIds, planTaskId = null) {
  let parsed;
  try {
    parsed = JSON.parse(tasksJson);
  } catch (e) {
    if (planTaskId) {
      updateTask(planTaskId, { status: 'failed', result: 'Invalid JSON: ' + e.message });
    }
    return { success: false, error: 'Invalid JSON: ' + e.message };
  }

  // Support both new { tasks, summary } format and old plain array format
  let items, summary;
  if (Array.isArray(parsed)) {
    items = parsed;
    summary = null;
  } else if (parsed && Array.isArray(parsed.tasks)) {
    items = parsed.tasks;
    summary = parsed.summary || null;
  } else {
    if (planTaskId) {
      updateTask(planTaskId, { status: 'failed', result: 'Unexpected JSON structure' });
    }
    return { success: false, error: 'Unexpected JSON structure' };
  }

  const createdTaskIds = [];
  let updated = 0, deleted = 0, created = 0;

  for (const t of items) {
    const action = t.action || 'create';

    if (action === 'delete' && t.existing_id) {
      deleteTask(t.existing_id);
      deleted++;
    } else if (action === 'update' && t.existing_id) {
      const fields = {};
      if (t.title) fields.title = t.title;
      if (t.description) fields.description = t.description;
      if (t.priority != null) fields.priority = t.priority;
      updateTask(t.existing_id, fields);
      updated++;
    } else {
      // create (or fallback for old format without action field)
      const taskId = createTask(
        sessionName,
        t.title || 'Untitled task',
        t.description || '',
        t.wish_ids || [],
        t.priority || 0
      );
      createdTaskIds.push(taskId);
      created++;
    }
  }

  // Mark wishes as processed
  if (wishIds && wishIds.length > 0) {
    markWishesProcessed(wishIds, createdTaskIds);
  }

  // Update plan-task with result
  if (planTaskId) {
    let resultText;
    if (items.length === 0) {
      resultText = summary || 'No tasks created';
    } else {
      resultText = `Created ${created} task(s)` +
        (updated ? `, updated ${updated}` : '') +
        (deleted ? `, deleted ${deleted}` : '') +
        (summary ? `. ${summary}` : '');
    }
    updateTask(planTaskId, { status: 'completed', result: resultText });
  }

  return { success: true, taskIds: createdTaskIds, count: created, updated, deleted, summary };
}

/**
 * Remove all data for a session: wishes, tasks, execution log.
 */
function cleanSession(sessionName) {
  const d = getDb();
  // Get task IDs for this session
  const taskIds = d.prepare('SELECT id FROM tasks WHERE session_name = ?').all(sessionName).map(r => r.id);
  if (taskIds.length > 0) {
    const placeholders = taskIds.map(() => '?').join(',');
    d.prepare(`DELETE FROM execution_log WHERE task_id IN (${placeholders})`).run(...taskIds);
  }
  d.prepare('DELETE FROM tasks WHERE session_name = ?').run(sessionName);
  d.prepare('DELETE FROM wishes WHERE session_name = ?').run(sessionName);

  // Clean active plan if any
  activePlans.delete(sessionName);

  // Clean active task executions for this session
  for (const [taskId, exec] of activeExecs) {
    if (exec.sessionName === sessionName) {
      tmux.killSession(exec.tmuxSession);
      activeExecs.delete(taskId);
    }
  }

  // Kill any remaining pipeline tmux sessions for this project
  const safeName = tmux.safeTmuxName(sessionName);
  const allTmux = tmux.listTmuxSessions();
  for (const s of allTmux) {
    if (s.startsWith(`csm-task-${safeName}`) || s.startsWith(`csm-exec-${safeName}`) || s.startsWith(`csm-plan-${safeName}`)) {
      tmux.killSession(s);
    }
  }
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  PipelineError,
  addWish,
  updateWish,
  deleteWish,
  getUnprocessedWishes,
  getAllWishes,
  markWishesProcessed,
  createTask,
  updateTask,
  deleteTask,
  getTasks,
  getAllTasks,
  updateTaskStatus,
  getNextPendingTask,
  hasRunningTask,
  logExecution,
  completeExecution,
  getExecutionLog,
  generatePlanningPrompt,
  executeNextTask,
  planTasks,
  getPlanStatus,
  cleanSession,
  executeTaskInteractive,
  executeTaskSilent,
  getTaskExecStatus,
  applyPlan,
  close,
};
