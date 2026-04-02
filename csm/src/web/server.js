const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const SessionMonitor = require('../lib/monitor');
const history = require('../lib/history');
const config = require('../lib/config');
const tmux = require('../lib/tmux');
const { PIPELINE_SESSION_RE } = require('../lib/utils');
const platform = require('../lib/platform');

let monitor = null;

// Safe wrapper: catches sync/async errors and returns JSON
function safe(fn) {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

function start(port = 9847, autoOpen = true, host) {
  const cfg = config.load();
  const bindHost = host || cfg.host || 'localhost';
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

  const pipeline = require('../lib/pipeline');

  // Serve static dashboard
  app.use(express.static(path.join(__dirname, '../../public')));
  app.use(express.json());

  // ─── REST API ────────────────────────────────────────

  app.get('/api/sessions', safe((req, res) => {
    res.json(monitor ? monitor.getState() : {});
  }));

  app.get('/api/sessions/:name', safe((req, res) => {
    const state = monitor?.getSessionState(req.params.name);
    if (!state) return res.status(404).json({ error: 'Session not found' });
    res.json(state);
  }));

  app.post('/api/sessions/:name/send', safe((req, res) => {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: 'No input provided' });
    const ok = monitor?.sendInput(req.params.name, input);
    res.json({ success: ok });
  }));

  app.post('/api/sessions/:name/focus', safe((req, res) => {
    const ok = monitor?.focusSession(req.params.name);
    res.json({ success: ok });
  }));

  // Send input to a specific task's tmux session (not the project session)
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

  // Focus (switch-to) a specific task's tmux session
  app.post('/api/tasks/:taskId/focus', safe((req, res) => {
    const mapping = pipeline.getSessionMapping(parseInt(req.params.taskId));
    if (!mapping || mapping.status !== 'active') {
      return res.status(404).json({ error: 'No active session for this task' });
    }
    const ok = tmux.switchTo(mapping.tmux_session_name);
    res.json({ success: ok });
  }));

  // Send raw keys (Enter, Ctrl+C, arrows, etc.) to a task's tmux session
  app.post('/api/tasks/:taskId/keys', safe((req, res) => {
    const { keys } = req.body;
    if (!keys) return res.status(400).json({ error: 'keys is required' });
    const mapping = pipeline.getSessionMapping(parseInt(req.params.taskId));
    if (!mapping || mapping.status !== 'active') {
      return res.status(404).json({ error: 'No active session for this task' });
    }
    try {
      execSync(`tmux send-keys -t "${mapping.tmux_session_name}" ${keys}`, { timeout: 5000 });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  app.get('/api/history/:name/status', safe((req, res) => {
    const hours = parseInt(req.query.hours) || 24;
    res.json(history.getStatusHistory(req.params.name, hours));
  }));

  app.get('/api/history/:name/tokens', safe((req, res) => {
    const hours = parseInt(req.query.hours) || 24;
    res.json(history.getTokenHistory(req.params.name, hours));
  }));

  app.get('/api/history/tokens', safe((req, res) => {
    const hours = parseInt(req.query.hours) || 24;
    res.json(history.getAllTokenHistory(hours));
  }));

  app.get('/api/history/:name/timeline', safe((req, res) => {
    const hours = parseInt(req.query.hours) || 24;
    res.json(history.getSessionTimeline(req.params.name, hours));
  }));

  app.get('/api/alerts', safe((req, res) => {
    res.json(history.getUnacknowledgedAlerts());
  }));

  app.post('/api/alerts/:id/acknowledge', safe((req, res) => {
    history.acknowledgeAlert(parseInt(req.params.id));
    res.json({ success: true });
  }));

  app.get('/api/config', safe((req, res) => {
    res.json(config.load());
  }));

  app.post('/api/config/session', safe((req, res) => {
    const { name, tmuxSession, tmuxWindow, tmuxPane, projectPath } = req.body;
    if (!name || !tmuxSession) {
      return res.status(400).json({ error: 'name and tmuxSession required' });
    }
    config.addSession(name, tmuxSession, { tmuxWindow, tmuxPane, projectPath });
    monitor?.reload();
    res.json({ success: true });
  }));

  app.delete('/api/config/session/:name', safe((req, res) => {
    config.removeSession(req.params.name);
    monitor?.reload();
    res.json({ success: true });
  }));

  // Create a NEW tmux session + start claude + register with CSM
  app.post('/api/sessions/create', safe((req, res) => {
    const { name, projectPath, startClaude } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const tmuxName = tmux.safeTmuxName(name);
    const result = tmux.createSession(tmuxName, projectPath || null, startClaude !== false);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    config.addSession(name, tmuxName, { projectPath: projectPath || null });
    monitor?.reload();
    res.json({ success: true, tmuxSession: tmuxName });
  }));

  // Kill tmux session + remove from CSM
  app.post('/api/sessions/:name/kill', safe((req, res) => {
    const sess = config.findSession(req.params.name);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    tmux.killSession(sess.tmuxSession);
    config.removeSession(req.params.name);
    monitor?.reload();
    res.json({ success: true });
  }));

  // Full project delete: kill tmux, remove config, clean DB
  app.post('/api/sessions/:name/destroy', safe((req, res) => {
    const name = req.params.name;
    const sess = config.findSession(name);

    // Kill main tmux session
    if (sess) {
      tmux.killSession(sess.tmuxSession);
    }

    // Kill any related tmux sessions (planning, execution, interactive tasks)
    const allTmux = tmux.listTmuxSessions();
    const safeName = tmux.safeTmuxName(name);
    for (const s of allTmux) {
      if (s.startsWith(`csm-plan-${safeName}`) || s.startsWith(`csm-exec-${safeName}`) || s.startsWith(`csm-task-${safeName}`)) {
        tmux.killSession(s);
      }
    }

    // Remove from config
    config.removeSession(name);

    // Clean pipeline DB (wishes + tasks)
    try {
      pipeline.cleanSession(name);
    } catch (e) { /* ignore if not implemented yet */ }

    monitor?.reload();
    res.json({ success: true });
  }));

  // Restart claude in a session
  app.post('/api/sessions/:name/restart', safe((req, res) => {
    const sess = config.findSession(req.params.name);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const target = sess.tmuxSession;
    execSync(`tmux send-keys -t "${target}" C-c`, { timeout: 5000 });
    setTimeout(() => {
      try {
        execSync(`tmux send-keys -t "${target}" "claude" Enter`, { timeout: 5000 });
      } catch (e) { /* ignore */ }
    }, 1000);
    res.json({ success: true });
  }));

  // Recreate the main tmux session for a project (when it died)
  app.post('/api/sessions/:name/recreate-tmux', safe((req, res) => {
    const sess = config.findSession(req.params.name);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    if (tmux.sessionExists(sess.tmuxSession)) {
      return res.status(400).json({ error: 'Session already alive' });
    }

    const result = tmux.createSession(sess.tmuxSession, sess.projectPath || null, true);
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    monitor?.reload();
    res.json({ success: true });
  }));

  // Send raw keys (Enter, Ctrl+C, arrows, etc.) to a session
  app.post('/api/sessions/:name/keys', safe((req, res) => {
    const sess = config.findSession(req.params.name);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const { keys } = req.body;
    if (!keys) return res.status(400).json({ error: 'keys is required' });

    const target = tmux.buildTarget
      ? tmux.buildTarget(sess.tmuxSession, sess.tmuxWindow, sess.tmuxPane)
      : sess.tmuxSession;

    try {
      // keys should be tmux key names like "Enter", "C-c", "Up", "Down", "y", etc.
      execSync(`tmux send-keys -t "${target}" ${keys}`, { timeout: 5000 });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // Open native terminal attached to tmux session (cross-platform)
  // ?tmux=session-name overrides the default tmux session (e.g. for planning)
  app.post('/api/sessions/:name/terminal', safe((req, res) => {
    let tmuxName = req.body?.tmux || req.query?.tmux;
    if (!tmuxName) {
      const sess = config.findSession(req.params.name);
      if (!sess) return res.status(404).json({ error: 'Session not found' });
      tmuxName = sess.tmuxSession;
    }

    const pInfo = platform.getPlatformInfo();
    console.log(`[Terminal] Opening: platform=${pInfo.platform}, hasDisplay=${pInfo.hasDisplay}, tmux=${tmuxName}`);

    try {
      platform.openTerminalAttach(tmuxName);
      res.json({ success: true });
    } catch (err) {
      console.error(`[Terminal] Failed:`, err.message);
      // Return fallback command so frontend can show it
      const safe = tmuxName.replace(/'/g, "'\\''");
      res.status(500).json({
        error: err.message,
        fallbackCommand: `tmux attach -t '${safe}'`,
        tmuxSession: tmuxName,
      });
    }
  }));

  // Platform info (OS, terminal name) for frontend
  app.get('/api/platform', safe((req, res) => {
    res.json(platform.getPlatformInfo());
  }));

  // Access info: detect local vs remote client, provide SSH connection details
  app.get('/api/access-info', safe((req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);

    // Find first non-internal IPv4 address for SSH host
    let sshHost = os.hostname();
    const nets = os.networkInterfaces();
    for (const iface of Object.values(nets)) {
      for (const net of iface) {
        if (net.family === 'IPv4' && !net.internal) {
          sshHost = net.address;
          break;
        }
      }
      if (sshHost !== os.hostname()) break;
    }

    res.json({
      isLocal,
      sshUser: os.userInfo().username,
      sshHost,
      serverHostname: os.hostname(),
    });
  }));

  // Browse filesystem directories (for directory picker)
  app.get('/api/fs/list', safe((req, res) => {
    const reqPath = req.query.path || os.homedir();
    const absPath = path.resolve(reqPath);

    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }

    const stat = fs.statSync(absPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }

    let entries;
    try {
      entries = fs.readdirSync(absPath, { withFileTypes: true });
    } catch (err) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    // Detect if this directory is a git repo
    const isGitRepo = fs.existsSync(path.join(absPath, '.git'));
    // Check for CLAUDE.md (Claude Code project marker)
    const hasClaudeMd = fs.existsSync(path.join(absPath, 'CLAUDE.md'));

    res.json({
      path: absPath,
      parent: path.dirname(absPath),
      dirs,
      isGitRepo,
      hasClaudeMd,
      homedir: os.homedir(),
    });
  }));

  // List available (untracked) tmux sessions
  app.get('/api/tmux/sessions', safe((req, res) => {
    const all = tmux.listTmuxSessions();
    const tracked = new Set(config.listSessions().map(s => s.tmuxSession));
    res.json({
      all,
      tracked: all.filter(s => tracked.has(s)),
      untracked: all.filter(s => !tracked.has(s)),
    });
  }));

  // Kill a specific tmux session by name
  app.post('/api/tmux/kill', safe((req, res) => {
    const { tmuxSession } = req.body;
    if (!tmuxSession) return res.status(400).json({ error: 'tmuxSession is required' });
    const ok = tmux.killSession(tmuxSession);
    res.json({ success: ok });
  }));

  // Kill all orphaned pipeline sessions (csm-task-*, csm-plan-*, csm-exec-*)
  app.post('/api/tmux/cleanup-pipeline', safe((req, res) => {
    const all = tmux.listTmuxSessions();
    const pipelineSessions = all.filter(s => PIPELINE_SESSION_RE.test(s));
    let killed = 0;
    for (const s of pipelineSessions) {
      if (tmux.killSession(s)) killed++;
    }
    res.json({ success: true, killed, total: pipelineSessions.length });
  }));

  // ─── Pipeline API ──────────────────────────────────────

  // Restore persistent session mappings (task↔tmux) from DB on startup
  try {
    pipeline.restoreSessionMappings();
    console.log('[Pipeline] Restored session mappings from DB');
  } catch (err) {
    console.error('[Pipeline] Failed to restore session mappings:', err.message);
  }

  app.get('/api/pipeline/:name/wishes', safe((req, res) => {
    res.json(pipeline.getAllWishes(req.params.name));
  }));

  app.post('/api/pipeline/:name/wishes', safe((req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    const id = pipeline.addWish(req.params.name, content);
    broadcast(wss, { type: 'wishAdded', data: { sessionName: req.params.name, id, content } });
    res.json({ success: true, id });
  }));

  app.put('/api/pipeline/wishes/:id', safe((req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });
    pipeline.updateWish(parseInt(req.params.id), content);
    res.json({ success: true });
  }));

  app.delete('/api/pipeline/wishes/:id', safe((req, res) => {
    pipeline.deleteWish(parseInt(req.params.id));
    res.json({ success: true });
  }));

  // All tmux sessions related to a project (main + tasks)
  app.get('/api/sessions/:name/tmux-sessions', safe((req, res) => {
    const sess = config.findSession(req.params.name);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const sessions = [];

    // Main project session
    sessions.push({
      type: 'project',
      tmuxSession: sess.tmuxSession,
      label: 'Main session',
      alive: tmux.sessionExists(sess.tmuxSession),
    });

    // Active task/plan sessions from pipeline mappings
    const mappings = pipeline.getActiveSessionMappings(req.params.name);
    for (const m of mappings) {
      const task = pipeline.getTasks(req.params.name).find(t => t.id === m.task_id);
      let type = 'task';
      if (m.tmux_session_name.startsWith('csm-plan-')) type = 'plan';
      else if (m.tmux_session_name.startsWith('csm-exec-')) type = 'silent';

      sessions.push({
        type,
        tmuxSession: m.tmux_session_name,
        label: task ? `Task #${task.id}: ${task.title}` : `Task #${m.task_id}`,
        taskId: m.task_id,
        alive: tmux.sessionExists(m.tmux_session_name),
        worktreePath: m.worktree_path || null,
      });
    }

    res.json(sessions);
  }));

  app.get('/api/pipeline/:name/tasks', safe((req, res) => {
    res.json(pipeline.getTasks(req.params.name, req.query.status || null));
  }));

  app.post('/api/pipeline/:name/tasks', safe((req, res) => {
    const { title, description, wishIds, priority, blocked_by } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const id = pipeline.createTask(req.params.name, title, description || '', wishIds || [], priority || 0);
    // Save dependencies if provided
    if (blocked_by && Array.isArray(blocked_by) && blocked_by.length > 0) {
      pipeline.saveTaskDependencies(id, blocked_by);
    }
    const blockers = pipeline.getBlockersForTask(id);
    broadcast(wss, { type: 'taskCreated', data: { sessionName: req.params.name, id, title, blocked_by: blockers } });
    res.json({ success: true, id });
  }));

  app.put('/api/pipeline/tasks/:id/status', safe((req, res) => {
    const { status, outputSummary } = req.body;
    pipeline.updateTaskStatus(parseInt(req.params.id), status, outputSummary);
    res.json({ success: true });
  }));

  app.put('/api/pipeline/tasks/:id', safe((req, res) => {
    pipeline.updateTask(parseInt(req.params.id), req.body);
    res.json({ success: true });
  }));

  app.delete('/api/pipeline/tasks/:id', safe((req, res) => {
    pipeline.deleteTask(parseInt(req.params.id));
    res.json({ success: true });
  }));

  // Task dependencies API
  app.get('/api/pipeline/tasks/:id/dependencies', safe((req, res) => {
    const taskId = parseInt(req.params.id);
    res.json({
      blocked_by: pipeline.getBlockersForTask(taskId),
      blocks: pipeline.getDependentsOfTask(taskId),
    });
  }));

  app.post('/api/pipeline/tasks/:id/dependencies', safe((req, res) => {
    const taskId = parseInt(req.params.id);
    const { blocked_by } = req.body;
    if (!Array.isArray(blocked_by)) return res.status(400).json({ error: 'blocked_by must be an array' });
    pipeline.removeTaskDependencies(taskId);
    pipeline.saveTaskDependencies(taskId, blocked_by);
    res.json({ success: true });
  }));

  app.post('/api/pipeline/:name/plan', safe((req, res) => {
    const result = pipeline.planTasks(req.params.name);
    if (result.planned) {
      broadcast(wss, { type: 'planStarted', data: { sessionName: req.params.name, tmuxSession: result.tmuxSession, wishIds: result.wishIds } });
    }
    res.json(result);
  }));

  app.get('/api/pipeline/:name/plan/status', safe((req, res) => {
    const result = pipeline.getPlanStatus(req.params.name);
    if (result.status === 'done' || result.status === 'error') {
      broadcast(wss, { type: 'planFinished', data: { sessionName: req.params.name, status: result.status, wishIds: result.wishIds } });
    }
    res.json(result);
  }));

  app.post('/api/pipeline/:name/apply-plan', safe((req, res) => {
    const { tasksJson, wishIds } = req.body;
    const result = pipeline.applyPlan(req.params.name, tasksJson, wishIds);
    if (result.success) {
      // Include full task list with dependencies in broadcast
      const tasks = pipeline.getTasks(req.params.name);
      broadcast(wss, { type: 'planApplied', data: { sessionName: req.params.name, ...result, tasks } });
    }
    res.json(result);
  }));

  // Interactive execution: run task in its own Claude session
  app.post('/api/pipeline/:name/execute-interactive', safe((req, res) => {
    const { taskId, noWorktree } = req.body;
    const result = pipeline.executeTaskInteractive(req.params.name, taskId, { noWorktree });
    if (result.started) {
      broadcast(wss, { type: 'taskStarted', data: { sessionName: req.params.name, ...result } });
    }
    res.json(result);
  }));

  // Silent execution: run task with --print in a tmux session
  app.post('/api/pipeline/:name/execute-silent', safe((req, res) => {
    const { taskId, noWorktree } = req.body;
    const result = pipeline.executeTaskSilent(req.params.name, taskId, { noWorktree });
    if (result.started) {
      broadcast(wss, { type: 'taskStarted', data: { sessionName: req.params.name, ...result } });
    }
    res.json(result);
  }));

  // Check silent task execution status
  app.get('/api/pipeline/:name/task-status/:taskId', safe((req, res) => {
    const taskId = parseInt(req.params.taskId);
    const result = pipeline.getTaskExecStatus(req.params.name, taskId);
    // Broadcast merge result if auto-merge happened during status check
    if (result.merge?.merged) {
      broadcast(wss, { type: 'taskMerged', data: { sessionName: req.params.name, taskId } });
    }
    res.json(result);
  }));

  // Get full task output (for completed tasks)
  app.get('/api/pipeline/:name/task-output/:taskId', safe((req, res) => {
    const output = pipeline.getTaskFullOutput(parseInt(req.params.taskId));
    res.json({ output });
  }));

  app.post('/api/pipeline/:name/execute', safe((req, res) => {
    const result = pipeline.executeNextTask(req.params.name);
    if (result.started) {
      broadcast(wss, { type: 'taskStarted', data: { sessionName: req.params.name, ...result } });
    }
    res.json(result);
  }));

  app.get('/api/pipeline/:name/executions', safe((req, res) => {
    res.json(pipeline.getExecutionLog(req.params.name));
  }));

  // ─── Worktree / Merge API ───────────────────────────

  const worktree = require('../lib/worktree');

  // Merge/resolve task worktree branch
  app.post('/api/pipeline/:name/tasks/:taskId/merge', safe((req, res) => {
    const taskId = parseInt(req.params.taskId);
    const { action } = req.body; // 'merge' (retry), 'rebase', or 'abort'
    const resolveAction = action || 'merge';

    const result = pipeline.resolveTaskMerge(taskId, resolveAction);

    if (result.success && result.merged) {
      broadcast(wss, { type: 'taskMerged', data: { sessionName: req.params.name, taskId } });
    } else if (result.success && !result.merged) {
      // abort case
      broadcast(wss, { type: 'taskMergeAborted', data: { sessionName: req.params.name, taskId } });
    } else if (result.conflictFiles) {
      broadcast(wss, {
        type: 'taskMergeConflict',
        data: { sessionName: req.params.name, taskId, conflictFiles: result.conflictFiles }
      });
    }

    res.json(result);
  }));

  // Get diff summary for a task's worktree branch
  app.get('/api/pipeline/:name/tasks/:taskId/diff', safe((req, res) => {
    const taskId = parseInt(req.params.taskId);
    const sess = config.findSession(req.params.name);
    if (!sess?.projectPath) return res.status(400).json({ error: 'No project path' });

    const repoRoot = worktree.getRepoRoot(sess.projectPath);
    if (!repoRoot) return res.status(400).json({ error: 'Not a git repository' });

    const branch = `csm/task-${taskId}`;

    try {
      const stat = execSync(`git diff --stat main...${branch}`, {
        cwd: repoRoot, stdio: 'pipe', encoding: 'utf8',
      }).trim();

      // Parse --stat output: last line like " 5 files changed, 42 insertions(+), 10 deletions(-)"
      const lines = stat.split('\n');
      const summaryLine = lines[lines.length - 1] || '';
      const filesMatch = summaryLine.match(/(\d+)\s+files?\s+changed/);
      const insMatch = summaryLine.match(/(\d+)\s+insertions?\(\+\)/);
      const delMatch = summaryLine.match(/(\d+)\s+deletions?\(-\)/);

      res.json({
        files_changed: filesMatch ? parseInt(filesMatch[1]) : 0,
        insertions: insMatch ? parseInt(insMatch[1]) : 0,
        deletions: delMatch ? parseInt(delMatch[1]) : 0,
        summary: stat,
      });
    } catch (err) {
      // Branch may not exist yet or no diff
      res.json({ files_changed: 0, insertions: 0, deletions: 0, summary: '' });
    }
  }));

  // Open terminal in worktree directory (cross-platform)
  app.post('/api/pipeline/:name/tasks/:taskId/open-terminal', safe((req, res) => {
    const taskId = parseInt(req.params.taskId);
    const wtPath = worktree.getWorktreePath(taskId);

    if (!fs.existsSync(wtPath)) {
      return res.status(404).json({ error: 'Worktree not found' });
    }

    try {
      platform.openTerminalInDir(wtPath);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // ─── Permissions API ────────────────────────────────

  app.get('/api/sessions/:name/permissions', safe((req, res) => {
    const sess = config.findSession(req.params.name);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const settingsPath = sess.projectPath
      ? path.join(sess.projectPath, '.claude', 'settings.local.json')
      : null;

    let perms = [];
    if (settingsPath && fs.existsSync(settingsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        perms = data?.permissions?.allow || [];
      } catch {}
    }
    res.json({ permissions: perms, path: settingsPath });
  }));

  app.post('/api/sessions/:name/permissions', safe((req, res) => {
    const sess = config.findSession(req.params.name);
    if (!sess?.projectPath) return res.status(400).json({ error: 'No project path' });

    const claudeDir = path.join(sess.projectPath, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.local.json');

    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });

    let data = {};
    if (fs.existsSync(settingsPath)) {
      try { data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
    }

    const { permissions } = req.body;
    data.permissions = data.permissions || {};
    data.permissions.allow = permissions;
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
    res.json({ success: true });
  }));

  // ─── JSON error handler (must be after all routes) ───

  app.use((err, req, res, _next) => {
    console.error(`[API Error] ${req.method} ${req.path}:`, err.message);

    const classified = classifyError(err);
    res.status(classified.status).json({
      error: classified.message,
      code: classified.code,
      hint: classified.hint || null,
    });
  });

  function classifyError(err) {
    const msg = err.message || '';
    const code = err.code || '';

    // PipelineError — already user-friendly
    if (err.name === 'PipelineError') {
      return { status: 500, message: msg, code: err.code };
    }

    // Network errors
    if (code === 'ECONNRESET' || msg.includes('ECONNRESET')) {
      return {
        status: 502, code: 'ECONNRESET',
        message: 'Соединение с API было сброшено',
        hint: 'Проверьте подключение к интернету и доступность API. Если проблема повторяется — возможно, API-ключ недействителен или превышен лимит запросов.',
      };
    }
    if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
      return {
        status: 502, code: 'ECONNREFUSED',
        message: 'Не удалось подключиться к API',
        hint: 'API-сервер недоступен. Проверьте подключение к интернету.',
      };
    }
    if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || msg.includes('ETIMEDOUT')) {
      return {
        status: 504, code: 'ETIMEDOUT',
        message: 'Превышено время ожидания ответа от API',
        hint: 'Попробуйте повторить операцию позже.',
      };
    }
    if (code === 'ENOTFOUND' || msg.includes('ENOTFOUND')) {
      return {
        status: 502, code: 'ENOTFOUND',
        message: 'DNS: не удалось найти сервер API',
        hint: 'Проверьте подключение к интернету и DNS-настройки.',
      };
    }

    // Claude CLI not found
    if (msg.includes('claude') && (msg.includes('not found') || msg.includes('ENOENT'))) {
      return {
        status: 500, code: 'CLAUDE_NOT_FOUND',
        message: 'Claude CLI не найден',
        hint: 'Установите: npm install -g @anthropic-ai/claude-code',
      };
    }

    // tmux errors
    if (msg.includes('tmux') && (msg.includes('no server') || msg.includes('not found'))) {
      return {
        status: 500, code: 'TMUX_ERROR',
        message: 'tmux не доступен',
        hint: 'Убедитесь, что tmux запущен: tmux new-session -d',
      };
    }

    // Rate limiting
    if (msg.includes('rate limit') || msg.includes('429') || msg.includes('Too Many Requests')) {
      return {
        status: 429, code: 'RATE_LIMITED',
        message: 'Превышен лимит запросов к API',
        hint: 'Подождите несколько минут и попробуйте снова.',
      };
    }

    // Default
    return {
      status: 500, code: 'INTERNAL_ERROR',
      message: msg || 'Внутренняя ошибка сервера',
    };
  }

  // ─── WebSocket ───────────────────────────────────────

  wss.on('connection', (ws) => {
    // Send current state immediately
    if (monitor) {
      ws.send(JSON.stringify({ type: 'state', data: monitor.getState() }));
    }

    // Send alerts (wrapped in try/catch in case DB is not ready)
    try {
      const alerts = history.getUnacknowledgedAlerts();
      if (alerts.length > 0) {
        ws.send(JSON.stringify({ type: 'alerts', data: alerts }));
      }
    } catch (err) {
      console.error('[WS] Failed to load alerts:', err.message);
    }
  });

  // ─── Monitor ─────────────────────────────────────────

  monitor = new SessionMonitor();

  monitor.on('update', (data) => {
    broadcast(wss, { type: 'update', data });
  });

  monitor.on('statusChange', (data) => {
    broadcast(wss, { type: 'statusChange', data });
  });

  monitor.on('alert', (data) => {
    broadcast(wss, { type: 'alert', data });
    try {
      const alerts = history.getUnacknowledgedAlerts();
      broadcast(wss, { type: 'alerts', data: alerts });
    } catch (err) {
      console.error('[Alert] Failed to load alerts:', err.message);
    }
  });

  monitor.start();

  // Cleanup old data daily
  setInterval(() => {
    try {
      const cfg = config.load();
      history.cleanup(cfg.historyRetention || 30);
    } catch (err) {
      console.error('[Cleanup] Error:', err.message);
    }
  }, 24 * 60 * 60 * 1000);

  // Auto-cleanup orphaned pipeline tmux sessions every 5 minutes
  // Kills csm-task-*/csm-plan-*/csm-exec-* sessions that have a shell prompt
  // (meaning Claude has finished and the session is idle)
  setInterval(() => {
    try {
      const all = tmux.listTmuxSessions();
      for (const s of all) {
        if (!PIPELINE_SESSION_RE.test(s)) continue;
        const output = tmux.capturePane(s, null, null);
        if (!output) continue;
        const lastLines = output.split('\n').slice(-3).join('\n');
        // If session shows a shell prompt ($), the pipeline process has exited
        if (/\$\s*$/.test(lastLines) && !/claude/.test(lastLines)) {
          console.log(`[Cleanup] Killing orphaned pipeline session: ${s}`);
          tmux.killSession(s);
        }
      }
    } catch (err) {
      console.error('[Pipeline Cleanup] Error:', err.message);
    }
  }, 5 * 60 * 1000);

  // ─── Start ───────────────────────────────────────────

  server.listen(port, bindHost, () => {
    if (bindHost === '0.0.0.0') {
      // Find LAN IP for the URL hint
      let lanIp = 'localhost';
      const nets = os.networkInterfaces();
      for (const iface of Object.values(nets)) {
        for (const net of iface) {
          if (net.family === 'IPv4' && !net.internal) { lanIp = net.address; break; }
        }
        if (lanIp !== 'localhost') break;
      }
      console.log(`\n  🖥  CSM Dashboard → http://${lanIp}:${port}`);
      console.log(`  ⚠  Server bound to 0.0.0.0 — accessible from network. No authentication.\n`);
    } else {
      console.log(`\n  🖥  CSM Dashboard → http://${bindHost}:${port}\n`);
    }
    if (autoOpen) {
      const open = require('open');
      open(`http://localhost:${port}`).catch(() => {});
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    monitor.stop();
    server.close();
    process.exit(0);
  });

  // Prevent crash on unhandled errors
  process.on('uncaughtException', (err) => {
    console.error('[FATAL]', err.message);
  });

  process.on('unhandledRejection', (err) => {
    console.error('[FATAL]', err);
  });
}

function broadcast(wss, data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

module.exports = { start };
