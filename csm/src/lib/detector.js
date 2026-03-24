const tmux = require('./tmux');

/**
 * Status enum
 */
const Status = {
  WORKING: 'working',
  NEEDS_INPUT: 'needs_input',
  IDLE: 'idle',
  ERROR: 'error',
  OFFLINE: 'offline',
};

/**
 * Patterns to detect Claude Code status from tmux pane output.
 * These match the typical Claude Code CLI indicators.
 */
const PATTERNS = {
  // Claude is actively processing — spinner, "Thinking", tool use indicators
  working: [
    /⏳/,
    /\bthinking\b/i,
    /\bworking\b/i,
    /\bRunning\b/,
    /\bSearching\b/,
    /\bReading\b/,
    /\bWriting\b/,
    /\bEditing\b/,
    /\bExecuting\b/,
    /\bAnalyzing\b/,
    /✻/,
    /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/, // spinner chars
    /Claude is working/i,
  ],
  // Claude needs user input — prompt, question mark, waiting for answer
  needsInput: [
    /^\s*>\s*$/m,                      // bare prompt
    /\?\s*$/m,                         // question ending
    /\(y\/n\)/i,                       // yes/no prompt
    /\[Y\/n\]/,                        // yes/no prompt
    /Press Enter/i,
    /Do you want to/i,
    /Would you like/i,
    /waiting for.*input/i,
    /\bYour turn\b/i,
    /\bReady for input\b/i,
    /❯/,                               // prompt char
    /\$\s*$/m,                         // shell prompt at end
  ],
  // Error indicators
  error: [
    /\bError\b.*:/,
    /\bFailed\b/i,
    /\bCrash\b/i,
    /\bPanic\b/i,
    /rate limit/i,
    /API error/i,
    /connection refused/i,
    /SIGTERM|SIGKILL/,
  ],
};

/**
 * Analyze captured pane output and determine session status.
 * Focuses on the last ~15 lines for the most recent state.
 */
function detectStatus(paneOutput) {
  if (!paneOutput) return { status: Status.OFFLINE, detail: 'No pane output' };

  const lines = paneOutput.split('\n');
  const recentLines = lines.slice(-20).join('\n');
  // Use last 15 lines for working/input detection — Claude TUI has separators/empty lines after prompt
  const lastFewLines = lines.slice(-15).join('\n');

  // Check for errors first (in recent 20 lines)
  for (const pattern of PATTERNS.error) {
    if (pattern.test(recentLines)) {
      const match = recentLines.match(pattern);
      return { status: Status.ERROR, detail: match ? match[0] : 'Error detected' };
    }
  }

  // Check if actively working (spinner, tool use)
  for (const pattern of PATTERNS.working) {
    if (pattern.test(lastFewLines)) {
      const match = lastFewLines.match(pattern);
      return { status: Status.WORKING, detail: match ? match[0].trim() : 'Working' };
    }
  }

  // Check if waiting for input
  for (const pattern of PATTERNS.needsInput) {
    if (pattern.test(lastFewLines)) {
      return { status: Status.NEEDS_INPUT, detail: 'Awaiting user input' };
    }
  }

  // Claude welcome screen / idle prompt detection — scan full pane
  // because TUI may render prompt near top with empty lines filling the rest
  if (/\? for shortcuts/.test(paneOutput) || /Welcome/.test(paneOutput)) {
    if (/❯/.test(paneOutput)) {
      return { status: Status.NEEDS_INPUT, detail: 'Ready for input' };
    }
  }

  // Last resort: check full pane for ❯ prompt (Claude TUI may have it anywhere)
  if (/❯/.test(paneOutput)) {
    return { status: Status.NEEDS_INPUT, detail: 'Awaiting user input' };
  }

  // Default: idle
  return { status: Status.IDLE, detail: 'No recent activity' };
}

/**
 * Extract token usage from pane output if visible.
 * Claude Code sometimes shows token counts in the status bar.
 */
function extractTokenUsage(paneOutput) {
  if (!paneOutput) return null;

  const tokenPatterns = [
    /(\d[\d,.]+)\s*\/\s*(\d[\d,.]+)\s*tokens?/i,
    /tokens?:\s*(\d[\d,.]+)\s*\/\s*(\d[\d,.]+)/i,
    /(\d[\d,.]+)\s*tokens?\s*used/i,
    /context:\s*(\d+(?:\.\d+)?[kKmM]?)\s*\/\s*(\d+(?:\.\d+)?[kKmM]?)/i,
  ];

  for (const pattern of tokenPatterns) {
    const match = paneOutput.match(pattern);
    if (match) {
      const used = parseTokenCount(match[1]);
      const total = match[2] ? parseTokenCount(match[2]) : null;
      return { used, total, percentage: total ? Math.round((used / total) * 100) : null };
    }
  }

  return null;
}

function parseTokenCount(str) {
  if (!str) return 0;
  str = str.replace(/,/g, '');
  const num = parseFloat(str);
  if (/[kK]$/.test(str)) return num * 1000;
  if (/[mM]$/.test(str)) return num * 1000000;
  return num;
}

/**
 * Extract the last meaningful output line (for preview in dashboard).
 */
function extractLastOutput(paneOutput, maxLines = 200) {
  if (!paneOutput) return '';
  // Keep all lines including empty ones to preserve formatting
  const lines = paneOutput.split('\n');
  // Trim trailing empty lines only
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.slice(-maxLines).join('\n');
}

module.exports = {
  Status,
  detectStatus,
  extractTokenUsage,
  extractLastOutput,
};
