const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const SessionMonitor = require('../lib/monitor');
const history = require('../lib/history');
const config = require('../lib/config');
const tmux = require('../lib/tmux');

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

function start(port = 9847, autoOpen = true) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server });

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
    const sess = config.listSessions().find(s => s.name === req.params.name);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    tmux.killSession(sess.tmuxSession);
    config.removeSession(req.params.name);
    monitor?.reload();
    res.json({ success: true });
  }));

  // Full project delete: kill tmux, remove config, clean DB
  app.post('/api/sessions/:name/destroy', safe((req, res) => {
    const name = req.params.name;
    const sess = config.listSessions().find(s => s.name === name);

    // Kill main tmux session
    if (sess) {
      tmux.killSession(sess.tmuxSession);
    }

    // Kill any related tmux sessions (planning, execution)
    const allTmux = tmux.listTmuxSessions();
    const safeName = tmux.safeTmuxName(name);
    for (const s of allTmux) {
      if (s.startsWith(`csm-plan-${safeName}`) || s.startsWith(`csm-exec-${safeName}`)) {
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
    const sess = config.listSessions().find(s => s.name === req.params.name);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const { execSync } = require('child_process');
    const target = sess.tmuxSession;
    execSync(`tmux send-keys -t "${target}" C-c`, { timeout: 5000 });
    setTimeout(() => {
      try {
        execSync(`tmux send-keys -t "${target}" "claude" Enter`, { timeout: 5000 });
      } catch (e) { /* ignore */ }
    }, 1000);
    res.json({ success: true });
  }));

  // Send raw keys (Enter, Ctrl+C, arrows, etc.) to a session
  app.post('/api/sessions/:name/keys', safe((req, res) => {
    const sess = config.listSessions().find(s => s.name === req.params.name);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const { keys } = req.body;
    if (!keys) return res.status(400).json({ error: 'keys is required' });

    const { execSync } = require('child_process');
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

  // Open native Terminal.app attached to tmux session
  // ?tmux=session-name overrides the default tmux session (e.g. for planning)
  app.post('/api/sessions/:name/terminal', safe((req, res) => {
    let tmuxName = req.body?.tmux || req.query?.tmux;
    if (!tmuxName) {
      const sess = config.listSessions().find(s => s.name === req.params.name);
      if (!sess) return res.status(404).json({ error: 'Session not found' });
      tmuxName = sess.tmuxSession;
    }

    const { execSync } = require('child_process');
    try {
      const script = `tell application "Terminal"
        activate
        do script "tmux attach -t '${tmuxName}'"
      end tell`;
      execSync(`osascript -e '${script}'`, { timeout: 5000 });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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

  // ─── Pipeline API ──────────────────────────────────────

  const pipeline = require('../lib/pipeline');

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

  app.get('/api/pipeline/:name/tasks', safe((req, res) => {
    res.json(pipeline.getTasks(req.params.name, req.query.status || null));
  }));

  app.post('/api/pipeline/:name/tasks', safe((req, res) => {
    const { title, description, wishIds, priority } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const id = pipeline.createTask(req.params.name, title, description || '', wishIds || [], priority || 0);
    broadcast(wss, { type: 'taskCreated', data: { sessionName: req.params.name, id, title } });
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

  app.post('/api/pipeline/:name/plan', safe((req, res) => {
    const result = pipeline.planTasks(req.params.name);
    res.json(result);
  }));

  app.get('/api/pipeline/:name/plan/status', safe((req, res) => {
    const result = pipeline.getPlanStatus(req.params.name);
    res.json(result);
  }));

  app.post('/api/pipeline/:name/apply-plan', safe((req, res) => {
    const { tasksJson, wishIds } = req.body;
    const result = pipeline.applyPlan(req.params.name, tasksJson, wishIds);
    if (result.success) {
      broadcast(wss, { type: 'planApplied', data: { sessionName: req.params.name, ...result } });
    }
    res.json(result);
  }));

  // Interactive execution: run task in its own Claude session
  app.post('/api/pipeline/:name/execute-interactive', safe((req, res) => {
    const { taskId } = req.body;
    const result = pipeline.executeTaskInteractive(req.params.name, taskId);
    if (result.started) {
      broadcast(wss, { type: 'taskStarted', data: { sessionName: req.params.name, ...result } });
    }
    res.json(result);
  }));

  // Silent execution: run task with --print in a tmux session
  app.post('/api/pipeline/:name/execute-silent', safe((req, res) => {
    const { taskId } = req.body;
    const result = pipeline.executeTaskSilent(req.params.name, taskId);
    if (result.started) {
      broadcast(wss, { type: 'taskStarted', data: { sessionName: req.params.name, ...result } });
    }
    res.json(result);
  }));

  // Check silent task execution status
  app.get('/api/pipeline/:name/task-status/:taskId', safe((req, res) => {
    const result = pipeline.getTaskExecStatus(req.params.name, parseInt(req.params.taskId));
    res.json(result);
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

  // ─── Permissions API ────────────────────────────────

  app.get('/api/sessions/:name/permissions', safe((req, res) => {
    const sess = config.listSessions().find(s => s.name === req.params.name);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const fs = require('fs');
    const p = require('path');
    const settingsPath = sess.projectPath
      ? p.join(sess.projectPath, '.claude', 'settings.local.json')
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
    const sess = config.listSessions().find(s => s.name === req.params.name);
    if (!sess?.projectPath) return res.status(400).json({ error: 'No project path' });

    const fs = require('fs');
    const p = require('path');
    const claudeDir = p.join(sess.projectPath, '.claude');
    const settingsPath = p.join(claudeDir, 'settings.local.json');

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
    res.status(500).json({ error: err.message });
  });

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

  // ─── Start ───────────────────────────────────────────

  server.listen(port, () => {
    console.log(`\n  🖥  CSM Dashboard → http://localhost:${port}\n`);
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
