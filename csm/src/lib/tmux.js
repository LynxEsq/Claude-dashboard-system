const { execSync } = require('child_process');

/**
 * Capture the visible content of a tmux pane.
 * Returns the last N lines of the pane output.
 */
function capturePane(tmuxSession, tmuxWindow, tmuxPane, lines = 500) {
  const target = buildTarget(tmuxSession, tmuxWindow, tmuxPane);
  try {
    // Capture full scrollback + visible screen
    const output = execSync(
      `tmux capture-pane -e -t "${target}" -p -S - -E -`,
      { encoding: 'utf-8', timeout: 5000 }
    );
    // Strip trailing empty/whitespace-only lines
    return output.replace(/(\r?\n\s*)+$/, '\n');
  } catch (err) {
    return null;
  }
}

/**
 * Send keys to a tmux pane (for sending input to Claude).
 */
function sendKeys(tmuxSession, tmuxWindow, tmuxPane, keys) {
  const target = buildTarget(tmuxSession, tmuxWindow, tmuxPane);
  try {
    execSync(`tmux send-keys -t "${target}" "${escapeForTmux(keys)}" Enter`, {
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * List all tmux sessions.
 */
function listTmuxSessions() {
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}"', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Check if a tmux session exists.
 */
function sessionExists(tmuxSession) {
  try {
    execSync(`tmux has-session -t "${tmuxSession}"`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Switch client to a specific tmux session/window/pane.
 */
function switchTo(tmuxSession, tmuxWindow, tmuxPane) {
  const target = buildTarget(tmuxSession, tmuxWindow, tmuxPane);
  try {
    execSync(`tmux select-window -t "${target}"`, { timeout: 5000 });
    if (tmuxPane) {
      execSync(`tmux select-pane -t "${target}"`, { timeout: 5000 });
    }
    return true;
  } catch {
    return false;
  }
}

function buildTarget(session, window, pane) {
  let target = session;
  if (window) target += `:${window}`;
  if (pane) target += `.${pane}`;
  return target;
}

/**
 * Create a new tmux session and optionally start claude in it.
 */
function createSession(tmuxSession, workDir, startClaude = true, claudeArgs = '') {
  try {
    if (sessionExists(tmuxSession)) {
      return { success: false, error: 'Session already exists' };
    }
    const cdArg = workDir ? `-c "${workDir}"` : '';
    execSync(`tmux new-session -d -s "${tmuxSession}" -x 200 -y 50 ${cdArg}`, { timeout: 5000 });
    if (startClaude) {
      const cmd = claudeArgs ? `claude --dangerously-skip-permissions ${claudeArgs}` : 'claude --dangerously-skip-permissions';
      // Use temp file + paste buffer to avoid shell interpretation of special chars (parentheses etc)
      const fs = require('fs');
      const os = require('os');
      const tmpFile = require('path').join(os.tmpdir(), `csm-claude-cmd-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, cmd);
      execSync(`tmux load-buffer "${tmpFile}"`, { timeout: 5000 });
      execSync(`tmux paste-buffer -t "${tmuxSession}"`, { timeout: 5000 });
      execSync(`tmux send-keys -t "${tmuxSession}" Enter`, { timeout: 5000 });
      try { fs.unlinkSync(tmpFile); } catch {}
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Kill a tmux session.
 */
function killSession(tmuxSession) {
  try {
    execSync(`tmux kill-session -t "${tmuxSession}" 2>/dev/null`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a long text to a tmux pane via a temp file + paste buffer.
 * Much more reliable than send-keys for multi-line or special-char content.
 */
function sendText(tmuxSession, tmuxWindow, tmuxPane, text) {
  const target = buildTarget(tmuxSession, tmuxWindow, tmuxPane);
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmpFile = path.join(os.tmpdir(), `csm-input-${Date.now()}.txt`);
  try {
    fs.writeFileSync(tmpFile, text);
    execSync(`tmux load-buffer "${tmpFile}"`, { timeout: 5000 });
    execSync(`tmux paste-buffer -t "${target}"`, { timeout: 5000 });
    execSync(`tmux send-keys -t "${target}" Enter`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

/**
 * Convert any string into a valid tmux session name (ASCII only).
 * Transliterates basic Cyrillic, strips the rest.
 */
function safeTmuxName(name) {
  const cyr = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
  const lat = 'abvgdeiozhziyklmnoprstufhtschshshiyeiuia'.match(/.{1,2}/g);
  // Simple char-by-char transliteration map
  const map = {};
  const cyrChars = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
  const latChars = ['a','b','v','g','d','e','yo','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','kh','ts','ch','sh','sch','','y','','e','yu','ya'];
  for (let i = 0; i < cyrChars.length; i++) {
    map[cyrChars[i]] = latChars[i];
    map[cyrChars[i].toUpperCase()] = latChars[i].charAt(0).toUpperCase() + latChars[i].slice(1);
  }

  let result = '';
  for (const ch of name) {
    if (map[ch] !== undefined) {
      result += map[ch];
    } else {
      result += ch;
    }
  }

  // Keep only ASCII alphanumeric, dash, underscore
  result = result.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!result) return `session-${Date.now()}`;

  // Collision detection: append counter if session name already exists
  const existing = listTmuxSessions();
  if (!existing.includes(result)) return result;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${result}-${i}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${result}-${Date.now()}`;
}

function escapeForTmux(str) {
  return str.replace(/"/g, '\\"').replace(/\$/g, '\\$');
}

module.exports = {
  capturePane,
  sendKeys,
  sendText,
  listTmuxSessions,
  sessionExists,
  switchTo,
  createSession,
  killSession,
  buildTarget,
  safeTmuxName,
};
