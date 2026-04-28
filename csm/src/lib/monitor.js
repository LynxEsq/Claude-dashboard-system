const EventEmitter = require('events');
const config = require('./config');
const tmux = require('./tmux');
const detector = require('./detector');
const history = require('./history');
const { cleanAnsi } = require('./utils');

class SessionMonitor extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();   // name -> session state
    this.interval = null;
    this.alertTimers = new Map(); // name -> { needsInputSince, idleSince }
    this.activity = {};           // name -> { lastActivityAt, addedAt }
  }

  start() {
    const cfg = config.load();
    this.pollInterval = cfg.pollInterval || 3000;
    this.alertConfig = cfg.alerts || {};

    // Initialize sessions from config
    for (const sess of cfg.sessions) {
      this.sessions.set(sess.name, {
        ...sess,
        status: detector.Status.OFFLINE,
        detail: 'Starting...',
        tokens: null,
        lastOutput: '',
        lastUpdate: null,
        statusSince: new Date(),
      });
    }

    // Load activity timestamps from DB.
    this.activity = history.getActivityMap();

    this.poll(); // immediate first poll
    this.interval = setInterval(() => this.poll(), this.pollInterval);
    this.emit('started');
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    history.close();
    this.emit('stopped');
  }

  reload() {
    const cfg = config.load();
    const currentNames = new Set(this.sessions.keys());
    const configNames = new Set(cfg.sessions.map(s => s.name));

    // Add new sessions
    for (const sess of cfg.sessions) {
      if (!currentNames.has(sess.name)) {
        this.sessions.set(sess.name, {
          ...sess,
          status: detector.Status.OFFLINE,
          detail: 'Initializing...',
          tokens: null,
          lastOutput: '',
          lastUpdate: null,
          statusSince: new Date(),
        });
      }
    }

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

  poll() {
    for (const [name, session] of this.sessions) {
      this.pollSession(name, session);
    }
  }

  pollSession(name, session) {
    // Check if tmux session exists
    if (!tmux.sessionExists(session.tmuxSession)) {
      const prevStatus = session.status;
      session.status = detector.Status.OFFLINE;
      session.detail = 'tmux session not found';
      session.lastOutput = '';
      session.lastUpdate = new Date();
      if (prevStatus !== session.status) {
        session.statusSince = new Date();
        this.emit('statusChange', { name, from: prevStatus, to: session.status, detail: session.detail });
      }
      this.emit('update', { name, session: { ...session } });
      return;
    }

    // Capture pane
    const paneOutput = tmux.capturePane(
      session.tmuxSession,
      session.tmuxWindow,
      session.tmuxPane
    );

    if (paneOutput === null) {
      const prevStatus = session.status;
      session.status = detector.Status.OFFLINE;
      session.detail = 'Cannot read pane';
      session.lastUpdate = new Date();
      if (prevStatus !== session.status) {
        session.statusSince = new Date();
        this.emit('statusChange', { name, from: prevStatus, to: session.status, detail: session.detail });
      }
      this.emit('update', { name, session: { ...session } });
      return;
    }

    // Strip ANSI for status detection (patterns expect clean text)
    const cleanOutput = cleanAnsi(paneOutput);

    // Detect status
    const { status, detail } = detector.detectStatus(cleanOutput);

    // Extract tokens
    const tokens = detector.extractTokenUsage(cleanOutput);

    // Extract last output for preview (keep ANSI for colored rendering)
    const lastOutput = detector.extractLastOutput(paneOutput, 200);

    // Update state
    const prevStatus = session.status;
    session.status = status;
    session.detail = detail;
    session.tokens = tokens;
    session.lastOutput = lastOutput;
    session.paneBuffer = paneOutput;  // full captured output for instant replay
    session.lastUpdate = new Date();

    if (prevStatus !== status) {
      session.statusSince = new Date();
      this.emit('statusChange', { name, from: prevStatus, to: status, detail });
    }

    // Log to history
    history.logStatus(
      name, status, detail,
      tokens?.used, tokens?.total
    );

    if (tokens) {
      history.logTokenSnapshot(name, tokens.used, tokens.total);
    }

    // Check alerts
    this.checkAlerts(name, session);

    this.emit('update', { name, session: { ...session } });
  }

  checkAlerts(name, session) {
    const timers = this.alertTimers.get(name) || {};
    const now = Date.now();

    // Needs Input timeout
    if (session.status === detector.Status.NEEDS_INPUT) {
      if (!timers.needsInputSince) {
        timers.needsInputSince = now;
      } else {
        const elapsed = (now - timers.needsInputSince) / 1000;
        if (elapsed > (this.alertConfig.needsInputTimeout || 300)) {
          if (!timers.needsInputAlerted) {
            history.createAlert(name, 'needs_input_timeout',
              `Session "${name}" has been waiting for input for ${Math.round(elapsed)}s`);
            timers.needsInputAlerted = true;
            this.emit('alert', { name, type: 'needs_input_timeout', elapsed });
          }
        }
      }
    } else {
      timers.needsInputSince = null;
      timers.needsInputAlerted = false;
    }

    // Idle timeout
    if (session.status === detector.Status.IDLE) {
      if (!timers.idleSince) {
        timers.idleSince = now;
      } else {
        const elapsed = (now - timers.idleSince) / 1000;
        if (elapsed > (this.alertConfig.idleTimeout || 600)) {
          if (!timers.idleAlerted) {
            history.createAlert(name, 'idle_timeout',
              `Session "${name}" has been idle for ${Math.round(elapsed)}s`);
            timers.idleAlerted = true;
            this.emit('alert', { name, type: 'idle_timeout', elapsed });
          }
        }
      }
    } else {
      timers.idleSince = null;
      timers.idleAlerted = false;
    }

    // Token threshold
    if (session.tokens?.percentage) {
      const threshold = this.alertConfig.tokenThreshold || 80;
      if (session.tokens.percentage >= threshold) {
        if (!timers.tokenAlerted) {
          history.createAlert(name, 'token_threshold',
            `Session "${name}" token usage at ${session.tokens.percentage}%`);
          timers.tokenAlerted = true;
          this.emit('alert', { name, type: 'token_threshold', percentage: session.tokens.percentage });
        }
      } else {
        timers.tokenAlerted = false;
      }
    }

    this.alertTimers.set(name, timers);
  }

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

  sendInput(name, input) {
    const session = this.sessions.get(name);
    if (!session) return false;
    return tmux.sendKeys(session.tmuxSession, session.tmuxWindow, session.tmuxPane, input);
  }

  focusSession(name) {
    const session = this.sessions.get(name);
    if (!session) return false;
    return tmux.switchTo(session.tmuxSession, session.tmuxWindow, session.tmuxPane);
  }

  setActivity(name, ts) {
    const cur = this.activity[name];
    if (cur) {
      cur.lastActivityAt = ts;
    } else {
      this.activity[name] = { lastActivityAt: ts, addedAt: ts };
    }
  }
}

module.exports = SessionMonitor;
