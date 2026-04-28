const { execSync } = require('child_process');
const { safe } = require('../middleware');

module.exports = function (app, ctx) {
  const { config, tmux, pipeline, platform, broadcast, wss, history } = ctx;

  app.get('/api/sessions', safe((req, res) => {
    res.json(ctx.monitor ? ctx.monitor.getState() : {});
  }));

  app.get('/api/sessions/:name', safe((req, res) => {
    const state = ctx.monitor?.getSessionState(req.params.name);
    if (!state) return res.status(404).json({ error: 'Session not found' });
    res.json(state);
  }));

  app.post('/api/sessions/:name/send', safe((req, res) => {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: 'No input provided' });
    const ok = ctx.monitor?.sendInput(req.params.name, input);
    if (ok) ctx.bumpActivity(req.params.name);
    res.json({ success: ok });
  }));

  app.post('/api/sessions/:name/focus', safe((req, res) => {
    const ok = ctx.monitor?.focusSession(req.params.name);
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
    if (ok && mapping.session_name) ctx.bumpActivity(mapping.session_name);
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
      if (mapping.session_name) ctx.bumpActivity(mapping.session_name);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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
    ctx.monitor?.reload();
    ctx.bumpActivity(name);
    res.json({ success: true, tmuxSession: tmuxName });
  }));

  // Kill tmux session + remove from CSM
  app.post('/api/sessions/:name/kill', safe((req, res) => {
    const sess = config.findSession(req.params.name);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    tmux.killSession(sess.tmuxSession);
    config.removeSession(req.params.name);
    history.deleteActivity(req.params.name);
    ctx.monitor?.reload();
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
    history.deleteActivity(name);

    // Clean pipeline DB (wishes + tasks)
    try {
      pipeline.cleanSession(name);
    } catch (e) { /* ignore if not implemented yet */ }

    ctx.monitor?.reload();
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
        execSync(`tmux send-keys -t "${target}" "claude --dangerously-skip-permissions" Enter`, { timeout: 5000 });
      } catch (e) { /* ignore */ }
    }, 1000);
    ctx.bumpActivity(req.params.name);
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

    ctx.monitor?.reload();
    ctx.bumpActivity(req.params.name);
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
      execSync(`tmux send-keys -t "${target}" ${keys}`, { timeout: 5000 });
      ctx.bumpActivity(req.params.name);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }));

  // Open native terminal attached to tmux session (cross-platform)
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
      ctx.bumpActivity(req.params.name);
      res.json({ success: true });
    } catch (err) {
      console.error(`[Terminal] Failed:`, err.message);
      const safe = tmuxName.replace(/'/g, "'\\''");
      res.status(500).json({
        error: err.message,
        fallbackCommand: `tmux attach -t '${safe}'`,
        tmuxSession: tmuxName,
      });
    }
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

  // Permissions
  app.get('/api/sessions/:name/permissions', safe((req, res) => {
    const sess = config.findSession(req.params.name);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const path = require('path');
    const fs = require('fs');
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

    const path = require('path');
    const fs = require('fs');
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
};
