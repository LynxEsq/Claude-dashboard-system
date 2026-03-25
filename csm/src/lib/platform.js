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

/**
 * Check if a graphical display is available (X11/Wayland/xrdp).
 */
function hasDisplay() {
  return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

// ─── Linux terminal helpers ─────────────────────────────────

/**
 * Try to open a Linux terminal emulator running a command.
 * Returns true if successful.
 */
function _openLinuxTerminalExec(cmd) {
  // Each entry: [binary, ...full shell command string]
  // We build the full command manually to handle quoting correctly
  const terminals = [
    { bin: 'xfce4-terminal', spawn: `xfce4-terminal -e "${cmd}"` },
    { bin: 'gnome-terminal', spawn: `gnome-terminal -- bash -c "${cmd}"` },
    { bin: 'x-terminal-emulator', spawn: `x-terminal-emulator -e "${cmd}"` },
    { bin: 'konsole', spawn: `konsole -e ${cmd}` },
    { bin: 'xterm', spawn: `xterm -e ${cmd}` },
  ];
  for (const { bin, spawn } of terminals) {
    try {
      execSync(`which ${bin}`, { stdio: 'ignore' });
      execSync(`${spawn} &`, { timeout: 5000, shell: true, stdio: 'ignore' });
      return true;
    } catch { /* try next */ }
  }
  return false;
}

/**
 * Try to open a Linux terminal emulator in a directory.
 * Returns true if successful.
 */
function _openLinuxTerminalDir(safePath) {
  const terminals = [
    { bin: 'xfce4-terminal', spawn: `xfce4-terminal --working-directory="${safePath}"` },
    { bin: 'gnome-terminal', spawn: `gnome-terminal --working-directory="${safePath}"` },
    { bin: 'konsole', spawn: `konsole --workdir "${safePath}"` },
    { bin: 'x-terminal-emulator', spawn: `x-terminal-emulator --working-directory="${safePath}"` },
    { bin: 'xterm', spawn: `xterm -e "cd '${safePath}' && exec bash"` },
  ];
  for (const { bin, spawn } of terminals) {
    try {
      execSync(`which ${bin}`, { stdio: 'ignore' });
      execSync(`${spawn} &`, { timeout: 5000, shell: true, stdio: 'ignore' });
      return true;
    } catch { /* try next */ }
  }
  return false;
}

// ─── Terminal openers ───────────────────────────────────────

/**
 * Open a native terminal attached to a tmux session.
 * @param {string} tmuxSession — tmux session name to attach to
 */
function openTerminalAttach(tmuxSession) {
  const platform = detectPlatform();
  const safe = tmuxSession.replace(/'/g, "'\\''");
  const cmd = `tmux attach -t '${safe}'`;

  switch (platform) {
    case 'macos': {
      const script = `tell application "Terminal"\nactivate\ndo script "tmux attach -t '${safe}'"\nend tell`;
      execSync(`osascript -e '${script}'`, { timeout: 5000 });
      break;
    }
    case 'wsl': {
      // If DISPLAY is set (xrdp/X11), try Linux terminal emulators first
      if (hasDisplay() && _openLinuxTerminalExec(cmd)) break;

      // Otherwise try Windows terminals
      try {
        execSync(`cmd.exe /c start wt.exe -w 0 wsl -e bash -ic "${cmd}"`, { timeout: 5000 });
      } catch {
        try {
          const distro = process.env.WSL_DISTRO_NAME || 'Ubuntu';
          execSync(`cmd.exe /c start cmd /c wsl -d ${distro} -- tmux attach -t '${safe}'`, { timeout: 5000 });
        } catch {
          throw new Error(`Cannot open terminal on WSL. Run manually: tmux attach -t '${safe}'`);
        }
      }
      break;
    }
    case 'linux': {
      if (!_openLinuxTerminalExec(cmd)) {
        throw new Error(`No terminal emulator found. Run manually: tmux attach -t '${safe}'`);
      }
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
      // If DISPLAY is set (xrdp/X11), try Linux terminal emulators first
      if (hasDisplay() && _openLinuxTerminalDir(safePath)) break;

      // Otherwise try Windows terminals
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
      if (!_openLinuxTerminalDir(safePath)) {
        throw new Error(`No terminal emulator found. Run manually: cd '${safePath}'`);
      }
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
    wsl: { name: 'WSL', terminal: hasDisplay() ? 'Terminal' : 'Windows Terminal' },
    linux: { name: 'Linux', terminal: 'Terminal' },
    windows: { name: 'Windows', terminal: 'Terminal' },
  };
  return { platform, hasDisplay: hasDisplay(), ...(labels[platform] || labels.linux) };
}

module.exports = { detectPlatform, hasDisplay, openTerminalAttach, openTerminalInDir, getPlatformInfo };
