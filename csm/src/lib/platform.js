'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

// ─── Platform detection ─────────────────────────────────────

let _platform = null;

function detectPlatform() {
  if (_platform) return _platform;

  const p = os.platform();

  if (p === 'darwin') {
    _platform = 'macos';
  } else if (p === 'linux') {
    // WSL detection: check /proc/version for Microsoft/WSL markers
    try {
      const procVersion = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
      if (procVersion.includes('microsoft') || procVersion.includes('wsl')) {
        _platform = 'wsl';
      } else {
        _platform = 'linux';
      }
    } catch {
      _platform = 'linux';
    }
  } else if (p === 'win32') {
    _platform = 'windows';
  } else {
    _platform = 'linux'; // fallback
  }

  return _platform;
}

// ─── Terminal openers ───────────────────────────────────────

/**
 * Open a native terminal attached to a tmux session.
 * @param {string} tmuxSession — tmux session name to attach to
 */
function openTerminalAttach(tmuxSession) {
  const platform = detectPlatform();
  const safe = tmuxSession.replace(/'/g, "'\\''");

  switch (platform) {
    case 'macos': {
      const script = `tell application "Terminal"\nactivate\ndo script "tmux attach -t '${safe}'"\nend tell`;
      execSync(`osascript -e '${script}'`, { timeout: 5000 });
      break;
    }
    case 'wsl': {
      // Try Windows Terminal first, fall back to cmd.exe
      const cmd = `tmux attach -t '${safe}'`;
      try {
        execSync(`cmd.exe /c start wt.exe -w 0 wsl -e bash -ic "${cmd}"`, { timeout: 5000 });
      } catch {
        try {
          const distro = process.env.WSL_DISTRO_NAME || 'Ubuntu';
          execSync(`cmd.exe /c start cmd /c wsl -d ${distro} -- tmux attach -t '${safe}'`, { timeout: 5000 });
        } catch {
          // Last resort: just provide the command (will be caught by caller)
          throw new Error(`Cannot open terminal on WSL. Run manually: tmux attach -t '${safe}'`);
        }
      }
      break;
    }
    case 'linux': {
      // Try common Linux terminal emulators in order
      const cmd = `tmux attach -t '${safe}'`;
      const terminals = [
        ['x-terminal-emulator', '-e', cmd],
        ['gnome-terminal', '--', 'bash', '-c', cmd],
        ['konsole', '-e', cmd],
        ['xfce4-terminal', '-e', cmd],
        ['xterm', '-e', cmd],
      ];
      let opened = false;
      for (const [bin, ...args] of terminals) {
        try {
          execSync(`which ${bin}`, { stdio: 'ignore' });
          execSync(`${bin} ${args.map(a => `'${a}'`).join(' ')} &`, { timeout: 5000, shell: true });
          opened = true;
          break;
        } catch { /* try next */ }
      }
      if (!opened) throw new Error(`No terminal emulator found. Run manually: tmux attach -t '${safe}'`);
      break;
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Open a native terminal in a specific directory.
 * @param {string} dirPath — directory to open terminal in
 */
function openTerminalInDir(dirPath) {
  const platform = detectPlatform();
  const safePath = dirPath.replace(/'/g, "'\\''");

  switch (platform) {
    case 'macos': {
      const escaped = dirPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script = `tell application "Terminal"\nactivate\ndo script "cd \\"${escaped}\\" && pwd"\nend tell`;
      execSync(`osascript -e ${JSON.stringify(script)}`, { timeout: 5000 });
      break;
    }
    case 'wsl': {
      const cmd = `cd '${safePath}' && exec bash`;
      try {
        execSync(`cmd.exe /c start wt.exe -w 0 wsl -e bash -ic "${cmd}"`, { timeout: 5000 });
      } catch {
        try {
          const distro = process.env.WSL_DISTRO_NAME || 'Ubuntu';
          execSync(`cmd.exe /c start cmd /c wsl -d ${distro} -- bash -c "cd '${safePath}' && exec bash"`, { timeout: 5000 });
        } catch {
          throw new Error(`Cannot open terminal on WSL. Run manually: cd '${safePath}'`);
        }
      }
      break;
    }
    case 'linux': {
      const terminals = [
        ['x-terminal-emulator', `--working-directory=${safePath}`],
        ['gnome-terminal', `--working-directory=${safePath}`],
        ['konsole', `--workdir`, safePath],
        ['xfce4-terminal', `--working-directory=${safePath}`],
        ['xterm', '-e', `bash -c "cd '${safePath}' && exec bash"`],
      ];
      let opened = false;
      for (const [bin, ...args] of terminals) {
        try {
          execSync(`which ${bin}`, { stdio: 'ignore' });
          execSync(`${bin} ${args.map(a => `'${a}'`).join(' ')} &`, { timeout: 5000, shell: true });
          opened = true;
          break;
        } catch { /* try next */ }
      }
      if (!opened) throw new Error(`No terminal emulator found. Run manually: cd '${safePath}'`);
      break;
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Get platform info for the frontend.
 */
function getPlatformInfo() {
  const platform = detectPlatform();
  const labels = {
    macos: { name: 'macOS', terminal: 'Terminal.app' },
    wsl: { name: 'WSL', terminal: 'Windows Terminal' },
    linux: { name: 'Linux', terminal: 'Terminal' },
    windows: { name: 'Windows', terminal: 'Terminal' },
  };
  return { platform, ...(labels[platform] || labels.linux) };
}

module.exports = { detectPlatform, openTerminalAttach, openTerminalInDir, getPlatformInfo };
