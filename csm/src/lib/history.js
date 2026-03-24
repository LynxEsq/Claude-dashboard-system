const { openDatabase } = require('./utils');

let db = null;

function getDb() {
  if (db) return db;
  db = openDatabase('history.db');
  initTables();
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS status_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_name TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      tokens_used INTEGER,
      tokens_total INTEGER,
      timestamp DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS token_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_name TEXT NOT NULL,
      tokens_used INTEGER,
      tokens_total INTEGER,
      timestamp DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_name TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      message TEXT,
      acknowledged INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_status_log_session
      ON status_log(session_name, timestamp);
    CREATE INDEX IF NOT EXISTS idx_token_snapshots_session
      ON token_snapshots(session_name, timestamp);
    CREATE INDEX IF NOT EXISTS idx_alerts_session
      ON alerts(session_name, acknowledged);
  `);
}

function logStatus(sessionName, status, detail, tokensUsed, tokensTotal) {
  const stmt = getDb().prepare(`
    INSERT INTO status_log (session_name, status, detail, tokens_used, tokens_total)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(sessionName, status, detail, tokensUsed || null, tokensTotal || null);
}

function logTokenSnapshot(sessionName, tokensUsed, tokensTotal) {
  const stmt = getDb().prepare(`
    INSERT INTO token_snapshots (session_name, tokens_used, tokens_total)
    VALUES (?, ?, ?)
  `);
  stmt.run(sessionName, tokensUsed, tokensTotal);
}

function createAlert(sessionName, alertType, message) {
  const stmt = getDb().prepare(`
    INSERT INTO alerts (session_name, alert_type, message)
    VALUES (?, ?, ?)
  `);
  stmt.run(sessionName, alertType, message);
}

function acknowledgeAlert(alertId) {
  getDb().prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?').run(alertId);
}

function getUnacknowledgedAlerts() {
  return getDb().prepare(
    'SELECT * FROM alerts WHERE acknowledged = 0 ORDER BY timestamp DESC'
  ).all();
}

function getStatusHistory(sessionName, hours = 24) {
  return getDb().prepare(`
    SELECT * FROM status_log
    WHERE session_name = ? AND timestamp > datetime('now', ?)
    ORDER BY timestamp ASC
  `).all(sessionName, `-${hours} hours`);
}

function getTokenHistory(sessionName, hours = 24) {
  return getDb().prepare(`
    SELECT * FROM token_snapshots
    WHERE session_name = ? AND timestamp > datetime('now', ?)
    ORDER BY timestamp ASC
  `).all(sessionName, `-${hours} hours`);
}

function getAllTokenHistory(hours = 24) {
  return getDb().prepare(`
    SELECT * FROM token_snapshots
    WHERE timestamp > datetime('now', ?)
    ORDER BY timestamp ASC
  `).all(`-${hours} hours`);
}

function getSessionTimeline(sessionName, hours = 24) {
  return getDb().prepare(`
    SELECT status, detail, timestamp FROM status_log
    WHERE session_name = ? AND timestamp > datetime('now', ?)
    ORDER BY timestamp ASC
  `).all(sessionName, `-${hours} hours`);
}

function cleanup(retentionDays = 30) {
  const cutoff = `-${retentionDays} days`;
  getDb().prepare("DELETE FROM status_log WHERE timestamp < datetime('now', ?)").run(cutoff);
  getDb().prepare("DELETE FROM token_snapshots WHERE timestamp < datetime('now', ?)").run(cutoff);
  getDb().prepare("DELETE FROM alerts WHERE timestamp < datetime('now', ?) AND acknowledged = 1").run(cutoff);
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  logStatus,
  logTokenSnapshot,
  createAlert,
  acknowledgeAlert,
  getUnacknowledgedAlerts,
  getStatusHistory,
  getTokenHistory,
  getAllTokenHistory,
  getSessionTimeline,
  cleanup,
  close,
};
