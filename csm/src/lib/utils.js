/**
 * Shared backend utilities — eliminates duplication across modules.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { CONFIG_DIR } = require('./config');

/** Regex matching CSM pipeline tmux sessions (task, plan, exec). */
const PIPELINE_SESSION_RE = /^csm-(task|plan|exec)-/;

/**
 * Open (or create) a SQLite database in CONFIG_DIR with WAL mode.
 * @param {string} filename - DB file name (e.g. 'history.db')
 * @param {object} [opts] - Extra pragmas: { foreignKeys: false }
 * @returns {import('better-sqlite3').Database}
 */
function openDatabase(filename, opts = {}) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const db = new Database(path.join(CONFIG_DIR, filename));
  db.pragma('journal_mode = WAL');
  if (opts.foreignKeys === false) {
    db.pragma('foreign_keys = OFF');
  }
  return db;
}

/**
 * Strip ANSI escape codes (SGR + OSC sequences) from terminal output.
 * @param {string} text
 * @returns {string}
 */
function cleanAnsi(text) {
  if (!text) return '';
  return text
    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1B\].*?\x07/g, '')
    .trim();
}

module.exports = {
  PIPELINE_SESSION_RE,
  openDatabase,
  cleanAnsi,
};
