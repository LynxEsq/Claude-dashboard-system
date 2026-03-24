const path = require('path');
const fs = require('fs');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.csm');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DB_FILE = path.join(CONFIG_DIR, 'history.db');

const DEFAULT_CONFIG = {
  port: 9847,
  pollInterval: 3000,       // ms between tmux polls
  historyRetention: 30,     // days to keep history
  alerts: {
    needsInputTimeout: 300,  // seconds before alerting on "Needs Input"
    idleTimeout: 600,        // seconds before alerting on idle
    tokenThreshold: 80,      // % token usage to warn
  },
  sessions: [],
  // session: { name, tmuxSession, tmuxWindow?, tmuxPane?, projectPath }
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function load() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    save(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function save(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function cleanPath(p) {
  if (!p) return null;
  // Strip wrapping quotes that may come from user input
  return p.replace(/^['"]|['"]$/g, '').trim() || null;
}

function addSession(name, tmuxSession, opts = {}) {
  const config = load();
  const existing = config.sessions.find(s => s.name === name);
  if (existing) {
    Object.assign(existing, { tmuxSession, ...opts, projectPath: cleanPath(opts.projectPath) });
  } else {
    config.sessions.push({
      name,
      tmuxSession,
      tmuxWindow: opts.tmuxWindow || null,
      tmuxPane: opts.tmuxPane || null,
      projectPath: cleanPath(opts.projectPath),
    });
  }
  save(config);
  return config;
}

function removeSession(name) {
  const config = load();
  config.sessions = config.sessions.filter(s => s.name !== name);
  save(config);
  return config;
}

function listSessions() {
  return load().sessions;
}

function findSession(name) {
  return listSessions().find(s => s.name === name) || null;
}

module.exports = {
  CONFIG_DIR, CONFIG_FILE, DB_FILE,
  load, save, addSession, removeSession, listSessions, findSession,
  DEFAULT_CONFIG,
};
