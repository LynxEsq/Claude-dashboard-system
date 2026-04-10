const path = require('path');
const fs = require('fs');
const os = require('os');
const { safe } = require('../middleware');
const { PIPELINE_SESSION_RE } = require('../../lib/utils');

module.exports = function (app, ctx) {
  const { config, history, tmux, platform } = ctx;

  // ─── History & Alerts ───────────────────────────────

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

  // ─── Config ─────────────────────────────────────────

  app.get('/api/config', safe((req, res) => {
    res.json(config.load());
  }));

  app.post('/api/config/session', safe((req, res) => {
    const { name, tmuxSession, tmuxWindow, tmuxPane, projectPath } = req.body;
    if (!name || !tmuxSession) {
      return res.status(400).json({ error: 'name and tmuxSession required' });
    }
    config.addSession(name, tmuxSession, { tmuxWindow, tmuxPane, projectPath });
    ctx.monitor?.reload();
    res.json({ success: true });
  }));

  app.delete('/api/config/session/:name', safe((req, res) => {
    config.removeSession(req.params.name);
    ctx.monitor?.reload();
    res.json({ success: true });
  }));

  // ─── Platform & Access ──────────────────────────────

  app.get('/api/platform', safe((req, res) => {
    res.json(platform.getPlatformInfo());
  }));

  app.get('/api/access-info', safe((req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);

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

  // ─── Filesystem ─────────────────────────────────────

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

    const isGitRepo = fs.existsSync(path.join(absPath, '.git'));
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

  // ─── Tmux Management ────────────────────────────────

  app.get('/api/tmux/sessions', safe((req, res) => {
    const all = tmux.listTmuxSessions();
    const tracked = new Set(config.listSessions().map(s => s.tmuxSession));
    res.json({
      all,
      tracked: all.filter(s => tracked.has(s)),
      untracked: all.filter(s => !tracked.has(s)),
    });
  }));

  app.post('/api/tmux/kill', safe((req, res) => {
    const { tmuxSession } = req.body;
    if (!tmuxSession) return res.status(400).json({ error: 'tmuxSession is required' });
    const ok = tmux.killSession(tmuxSession);
    res.json({ success: ok });
  }));

  app.post('/api/tmux/cleanup-pipeline', safe((req, res) => {
    const all = tmux.listTmuxSessions();
    const pipelineSessions = all.filter(s => PIPELINE_SESSION_RE.test(s));
    let killed = 0;
    for (const s of pipelineSessions) {
      if (tmux.killSession(s)) killed++;
    }
    res.json({ success: true, killed, total: pipelineSessions.length });
  }));
};
