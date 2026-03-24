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
  // Prompt indicators — checked on last 5 lines FIRST to override stale working matches.
  // Must use same window size as working patterns to avoid working overriding prompt.
  prompt: [
    /❯/,                               // Claude Code prompt char
    /^\s*>\s*$/m,                      // bare prompt
    /\$\s*$/m,                         // shell prompt at end
    /%\s*$/m,                          // zsh prompt
    /^\s*#\s*$/m,                      // root prompt
  ],
  // Claude is actively processing — spinner, "Thinking", tool use indicators.
  // Only real-time activity indicators; avoid matching stale task descriptions.
  // Patterns require line-start context to avoid matching inside prose/log text.
  working: [
    /⏳/,
    /\bthinking\b/i,
    /✻(?!\s*(Cogitated|Baked|Completed|Finished|Done|Took|for\s+\d))/,  // active spinner, not completion summary
    /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/, // spinner chars
    /Claude is working/i,
    /^\s*⎿?\s*(Searching|Reading|Writing|Editing|Executing|Analyzing)\b/m, // tool-use lines (indented or with ⎿ prefix)
    /^\s*⎿?\s*Running\s+(command|bash|tool|test|npm|node|script)/im,       // Running a tool/command, not "Running task..."
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
    /%\s*$/m,                          // zsh prompt
    /^\s*#\s*$/m,                      // root prompt
    /\bAllow\b.*\?/,                   // Claude Code permission prompt ("Allow Read?")
    /\bDo you want to proceed\b/i,
    /\(yes\/no\)/i,
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
 *
 * Priority: prompt on last lines > errors > working (narrow window) > input > idle
 *
 * Key insight: if the very last lines show a prompt (❯, $, >), Claude is done
 * and waiting for input — regardless of working keywords in earlier output.
 */
function detectStatus(paneOutput) {
  if (!paneOutput) return { status: Status.OFFLINE, detail: 'No pane output' };

  const lines = paneOutput.split('\n');
  const recentLines = lines.slice(-20).join('\n');
  // Last 5 lines — used for both prompt and working detection (same window = fair priority)
  const narrowWindow = lines.slice(-5).join('\n');
  // Last 2 lines — the very bottom of the terminal for definitive prompt detection
  const bottomLines = lines.slice(-2).join('\n');

  // FIRST: check last 5 lines for prompt — if prompt is visible, Claude is done.
  // Use same window as working to ensure prompt always wins over stale working indicators.
  for (const pattern of PATTERNS.prompt) {
    if (pattern.test(narrowWindow)) {
      return { status: Status.NEEDS_INPUT, detail: 'Awaiting user input' };
    }
  }

  // Check for errors (in recent 20 lines)
  for (const pattern of PATTERNS.error) {
    if (pattern.test(recentLines)) {
      const match = recentLines.match(pattern);
      return { status: Status.ERROR, detail: match ? match[0] : 'Error detected' };
    }
  }

  // Check if actively working — only in last 5 lines to avoid stale tool-use output
  for (const pattern of PATTERNS.working) {
    if (pattern.test(narrowWindow)) {
      const match = narrowWindow.match(pattern);
      return { status: Status.WORKING, detail: match ? match[0].trim() : 'Working' };
    }
  }

  // Check if waiting for input (broader scan)
  for (const pattern of PATTERNS.needsInput) {
    if (pattern.test(narrowWindow)) {
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
