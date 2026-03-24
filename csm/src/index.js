#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const config = require('./lib/config');
const tmux = require('./lib/tmux');
const SessionMonitor = require('./lib/monitor');

program
  .name('csm')
  .description('Claude Session Manager — monitor and manage Claude Code sessions in tmux')
  .version('1.0.0');

// Default command: show status overview
program
  .command('status', { isDefault: true })
  .description('Show status of all monitored sessions')
  .option('-w, --watch', 'Watch mode — refresh every 3 seconds')
  .action(async (opts) => {
    const sessions = config.listSessions();
    if (sessions.length === 0) {
      console.log(chalk.yellow('No sessions configured. Use `csm add <name> <tmux-session>` to add one.'));
      return;
    }

    if (opts.watch) {
      await watchMode();
    } else {
      showStatus(sessions);
    }
  });

// Add a session
program
  .command('add <name> <tmux-session>')
  .description('Add a Claude Code session to monitor')
  .option('-w, --window <window>', 'tmux window name or index')
  .option('-p, --pane <pane>', 'tmux pane index')
  .option('-d, --dir <path>', 'Project directory path')
  .action((name, tmuxSession, opts) => {
    config.addSession(name, tmuxSession, {
      tmuxWindow: opts.window,
      tmuxPane: opts.pane,
      projectPath: opts.dir,
    });
    console.log(chalk.green(`✓ Added session "${name}" → tmux:${tmuxSession}`));
  });

// Remove a session
program
  .command('remove <name>')
  .description('Remove a session from monitoring')
  .action((name) => {
    config.removeSession(name);
    console.log(chalk.green(`✓ Removed session "${name}"`));
  });

// List sessions
program
  .command('list')
  .description('List all configured sessions')
  .action(() => {
    const sessions = config.listSessions();
    if (sessions.length === 0) {
      console.log(chalk.yellow('No sessions configured.'));
      return;
    }
    console.log(chalk.bold('\nConfigured sessions:\n'));
    for (const s of sessions) {
      const target = [s.tmuxSession, s.tmuxWindow, s.tmuxPane].filter(Boolean).join(':');
      console.log(`  ${chalk.cyan(s.name.padEnd(15))} → tmux:${target}${s.projectPath ? `  (${s.projectPath})` : ''}`);
    }
    console.log();
  });

// Web dashboard
program
  .command('web')
  .description('Start the web dashboard on localhost:9847')
  .option('-p, --port <port>', 'Port number', '9847')
  .option('--no-open', 'Don\'t auto-open browser')
  .action(async (opts) => {
    await startWeb(parseInt(opts.port), opts.open);
  });

// Shortcut: --web flag on main command
program
  .option('--web', 'Start web dashboard')
  .option('--port <port>', 'Web dashboard port');

// Send input to a session
program
  .command('send <name> <input...>')
  .description('Send input text to a session\'s tmux pane')
  .action((name, input) => {
    const text = input.join(' ');
    const session = config.listSessions().find(s => s.name === name);
    if (!session) {
      console.log(chalk.red(`Session "${name}" not found.`));
      return;
    }
    const ok = tmux.sendKeys(session.tmuxSession, session.tmuxWindow, session.tmuxPane, text);
    if (ok) {
      console.log(chalk.green(`✓ Sent to "${name}": ${text}`));
    } else {
      console.log(chalk.red(`✗ Failed to send to "${name}"`));
    }
  });

// Focus a session
program
  .command('focus <name>')
  .description('Switch tmux focus to a session')
  .action((name) => {
    const session = config.listSessions().find(s => s.name === name);
    if (!session) {
      console.log(chalk.red(`Session "${name}" not found.`));
      return;
    }
    tmux.switchTo(session.tmuxSession, session.tmuxWindow, session.tmuxPane);
    console.log(chalk.green(`✓ Focused on "${name}"`));
  });

// Discover tmux sessions that might have Claude running
program
  .command('discover')
  .description('Find tmux sessions that might be running Claude Code')
  .option('--cleanup', 'Kill all orphaned pipeline sessions')
  .action((opts) => {
    const tmuxSessions = tmux.listTmuxSessions();
    if (tmuxSessions.length === 0) {
      console.log(chalk.yellow('No tmux sessions found.'));
      return;
    }

    if (opts.cleanup) {
      const pipelineRe = /^csm-(task|plan|exec)-/;
      let killed = 0;
      for (const s of tmuxSessions) {
        if (pipelineRe.test(s)) {
          tmux.killSession(s);
          killed++;
          console.log(chalk.red(`  ✗ Killed: ${s}`));
        }
      }
      console.log(killed > 0
        ? chalk.green(`\n✓ Cleaned up ${killed} pipeline session(s)`)
        : chalk.gray('\nNo pipeline sessions to clean up'));
      return;
    }

    const configured = new Set(config.listSessions().map(s => s.tmuxSession));
    const pipelineRe = /^csm-(task|plan|exec)-/;

    console.log(chalk.bold('\nAvailable tmux sessions:\n'));
    for (const s of tmuxSessions) {
      const tracked = configured.has(s) ? chalk.green(' [tracked]') : '';
      let typeLabel = '';
      if (s.startsWith('csm-task-')) {
        const m = s.match(/^csm-task-(.+)-(\d+)$/);
        typeLabel = m ? chalk.magenta(` [task #${m[2]} → ${m[1]}]`) : chalk.magenta(' [task session]');
      } else if (s.startsWith('csm-exec-')) {
        const m = s.match(/^csm-exec-(.+)-(\d+)$/);
        typeLabel = m ? chalk.magenta(` [exec #${m[2]} → ${m[1]}]`) : chalk.magenta(' [exec session]');
      } else if (s.startsWith('csm-plan-')) {
        const m = s.match(/^csm-plan-(.+)$/);
        typeLabel = m ? chalk.magenta(` [planning → ${m[1]}]`) : chalk.magenta(' [planning session]');
      }
      console.log(`  ${chalk.cyan(s)}${tracked}${typeLabel}`);
    }
    console.log(chalk.gray(`\nUse: csm add <name> <tmux-session> to start monitoring`));
    console.log(chalk.gray(`Use: csm discover --cleanup to kill orphaned pipeline sessions\n`));
  });

// Config command
program
  .command('config')
  .description('Show or edit configuration')
  .option('--show', 'Show current config')
  .option('--set <key=value>', 'Set a config value')
  .action((opts) => {
    if (opts.set) {
      const [key, val] = opts.set.split('=');
      const cfg = config.load();
      cfg[key] = isNaN(val) ? val : Number(val);
      config.save(cfg);
      console.log(chalk.green(`✓ Set ${key} = ${val}`));
    } else {
      console.log(JSON.stringify(config.load(), null, 2));
    }
  });

// Parse
program.parse(process.argv);

// Handle --web flag
if (program.opts().web) {
  startWeb(parseInt(program.opts().port) || 9847, true);
}

// ─── Helper Functions ──────────────────────────────────────────

function showStatus(sessions) {
  const detector = require('./lib/detector');

  console.log(chalk.bold('\n  Claude Session Manager\n'));

  for (const sess of sessions) {
    const exists = tmux.sessionExists(sess.tmuxSession);
    if (!exists) {
      console.log(formatLine(sess.name, 'offline', 'tmux session not found'));
      continue;
    }

    const paneOutput = tmux.capturePane(sess.tmuxSession, sess.tmuxWindow, sess.tmuxPane);
    const { status, detail } = detector.detectStatus(paneOutput);
    const tokens = detector.extractTokenUsage(paneOutput);

    let tokenStr = '';
    if (tokens?.percentage) {
      tokenStr = `  ${tokenBar(tokens.percentage)} ${tokens.percentage}%`;
    }

    console.log(formatLine(sess.name, status, detail) + tokenStr);
  }
  console.log();
}

function formatLine(name, status, detail) {
  const icons = {
    working: chalk.green('●'),
    needs_input: chalk.yellow('▲'),
    idle: chalk.gray('○'),
    error: chalk.red('✗'),
    offline: chalk.gray('⊘'),
  };
  const colors = {
    working: chalk.green,
    needs_input: chalk.yellow,
    idle: chalk.gray,
    error: chalk.red,
    offline: chalk.gray,
  };
  const icon = icons[status] || chalk.gray('?');
  const color = colors[status] || chalk.gray;
  const statusLabel = {
    working: 'Working',
    needs_input: 'Needs Input',
    idle: 'Idle',
    error: 'Error',
    offline: 'Offline',
  }[status] || status;

  return `  ${icon} ${chalk.bold(name.padEnd(15))} ${color(statusLabel.padEnd(13))} ${chalk.gray(detail || '')}`;
}

function tokenBar(percentage) {
  const total = 15;
  const filled = Math.round((percentage / 100) * total);
  const bar = '█'.repeat(filled) + '░'.repeat(total - filled);
  if (percentage >= 80) return chalk.red(bar);
  if (percentage >= 60) return chalk.yellow(bar);
  return chalk.green(bar);
}

async function watchMode() {
  const detector = require('./lib/detector');

  process.stdout.write('\x1B[?25l'); // hide cursor
  process.on('SIGINT', () => {
    process.stdout.write('\x1B[?25h'); // show cursor
    process.exit(0);
  });

  while (true) {
    const sessions = config.listSessions();
    process.stdout.write('\x1B[2J\x1B[H'); // clear screen
    showStatus(sessions);
    console.log(chalk.gray('  Press Ctrl+C to exit. Refreshing every 3s...'));
    await new Promise(r => setTimeout(r, 3000));
  }
}

async function startWeb(port, autoOpen) {
  const server = require('./web/server');
  server.start(port, autoOpen);
}
