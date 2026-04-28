const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const SessionMonitor = require('../lib/monitor');
const history = require('../lib/history');
const config = require('../lib/config');
const tmux = require('../lib/tmux');
const { PIPELINE_SESSION_RE } = require('../lib/utils');
const platform = require('../lib/platform');
const { errorHandler } = require('./middleware');
const DataBatcher = require('./batcher');

let monitor = null;

function broadcast(wss, data, { projectFilter = null, subscribedOnly = false } = {}) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (subscribedOnly && projectFilter && client.subscribedProject !== projectFilter) continue;
    client.send(msg);
  }
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

  // ─── JSON error handler (must be after all routes) ──

  app.use(errorHandler);

  // ─── WebSocket ──────────────────────────────────────

  wss.on('connection', (ws) => {
    ws.subscribedProject = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'subscribe') {
          ws.subscribedProject = msg.project || null;
        }
      } catch {}
    });

    // Send current state immediately
    if (monitor) {
      ws.send(JSON.stringify({ type: 'state', data: monitor.getState() }));
    }

    // Send alerts
    try {
      const alerts = history.getUnacknowledgedAlerts();
      if (alerts.length > 0) {
        ws.send(JSON.stringify({ type: 'alerts', data: alerts }));
      }
    } catch (err) {
      console.error('[WS] Failed to load alerts:', err.message);
    }
  });

  // ─── Monitor ────────────────────────────────────────

  monitor = new SessionMonitor();
  ctx.monitor = monitor;

  const updateBatcher = new DataBatcher((batch) => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(batch);
      }
    }
  });

  monitor.on('update', (data) => {
    updateBatcher.push({ type: 'update', data });
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
  setInterval(() => {
    try {
      const all = tmux.listTmuxSessions();
      for (const s of all) {
        if (!PIPELINE_SESSION_RE.test(s)) continue;
        const output = tmux.capturePane(s, null, null);
        if (!output) continue;
        const lastLines = output.split('\n').slice(-3).join('\n');
        if (/\$\s*$/.test(lastLines) && !/claude/.test(lastLines)) {
          console.log(`[Cleanup] Killing orphaned pipeline session: ${s}`);
          tmux.killSession(s);
        }
      }
    } catch (err) {
      console.error('[Pipeline Cleanup] Error:', err.message);
    }
  }, 5 * 60 * 1000);

  // ─── Start ──────────────────────────────────────────

  server.listen(port, bindHost, () => {
    if (bindHost === '0.0.0.0') {
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

module.exports = { start };
