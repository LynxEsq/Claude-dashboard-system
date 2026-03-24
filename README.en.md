# CSM — Claude Session Manager

A single control center for all your Claude Code sessions. Monitoring, tasks, pipeline — everything in one web dashboard.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![tmux](https://img.shields.io/badge/tmux-required-1BB91F?logo=tmux&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)

> **[Русская версия](README.md)**

---

## Screenshots

| Dashboard | Pipeline |
|-----------|----------|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Pipeline](docs/screenshots/pipeline.png) |

| Terminal | Statuses |
|----------|----------|
| ![Terminal](docs/screenshots/terminal.png) | ![Statuses](docs/screenshots/statuses.png) |

---

## What is this and why

You're working with Claude Code on multiple projects at once. Each project is a separate tmux session. You switch between them, lose context, forget that Claude has been waiting for your input for 10 minutes somewhere.

**CSM solves this problem.** One web dashboard shows all sessions at a glance: who's working, who needs input, where there's an error, how many tokens are spent. You can send input directly from the browser without switching tmux.

But CSM is more than just a monitor. It's a **work management system**:

- Write ideas and wishes to each project's Inbox
- AI converts them into concrete tasks
- Tasks execute one by one, each in its own Claude session
- You watch the progress from the dashboard

---

## How it works

### Projects = contexts

Each project in CSM is a code directory linked to a tmux session. CSM doesn't know about your code directly — it watches the tmux pane where Claude Code runs and detects status by matching patterns in terminal output.

```
Project "bms"  →  tmux session "bms"  →  Claude Code working inside
Project "api"  →  tmux session "api"  →  Claude Code waiting for input
```

### Wishes — your Inbox

A wish is a high-level request. Not a task, not a ticket, but a thought: *"I want login to work through OAuth"*, *"rewrite tests to vitest"*, *"add dark theme"*.

Write wishes when the thought comes — right in the dashboard, in the Inbox column of the selected project. No need to formulate precisely right away. Wishes accumulate until you're ready to process them.

### Tasks — units of work

When wishes pile up, you hit **Plan** — AI analyzes all unprocessed wishes and generates concrete tasks:

- Several related wishes can become one task
- One large wish can split into multiple tasks
- Each task is specific enough for Claude Code to complete in a single session

Tasks get a priority and a description sufficient for autonomous execution.

### Execution — one session per task

Each task runs in a separate Claude Code session. CSM creates a tmux session, starts Claude, sends a prompt with the task description and project context. Two modes:

| Mode | When to use |
|------|-------------|
| **Silent** (background) | Task is simple and unambiguous. Claude works autonomously, you review the result after |
| **Interactive** | Task requires decisions along the way. CSM shows when Claude needs input, you respond from the dashboard |

---

## Best practices

### How to write wishes

**Good** — describe *what you want*, not how to do it:
```
Add PDF report export with charts
Rewrite auth — tokens are stored in localStorage now, need httpOnly cookies
Tests fail on CI but pass locally, investigate
```

**Bad** — too vague or dictating implementation:
```
Improve the project                      # too abstract
Open file auth.js line 47 and replace    # that's not a wish, it's a direct command
```

### Single session vs parallel

| Situation | Approach |
|-----------|----------|
| Related changes in one project | Single session, wishes in sequence |
| Independent projects | Parallel sessions — that's what CSM is for |
| Large refactoring | Single session — Claude needs full context |
| Many small fixes in different places | Parallel sessions with separate tasks |

### Reading statuses

| Status | Meaning | Action |
|--------|---------|--------|
| **Working** | Claude is thinking or writing code | Wait |
| **Needs Input** | Claude asked a question or awaits confirmation | Switch and respond (or respond from dashboard) |
| **Idle** | Session is idle — task finished or Claude awaits a command | Review result, give a new task |
| **Error** | Error, rate limit, connection issue | Check terminal, resolve the problem |
| **Offline** | tmux session not found | Recreate or remove from monitoring |

CSM sends alerts when a session stays in **Needs Input** for over 5 minutes or **Idle** for over 10 minutes.

### Pipeline: wish → plan → execute

```
1. Write wishes to project Inbox
         ↓
2. Hit "Plan" — AI groups wishes into tasks
         ↓
3. Review tasks, adjust priorities
         ↓
4. "Execute" — tasks run one by one
         ↓
5. Review results, add new wishes
```

You don't have to use the full pipeline. You can simply monitor sessions and send input — CSM works as a plain monitor too.

---

## Quick start

### Requirements

- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** — installed and authenticated (`claude` available in terminal). CSM manages Claude Code sessions, so it won't work without it
- **Node.js** 18+
- **tmux** (installed and running)
- **macOS** or **Linux**

### Installation

```bash
git clone https://github.com/LynxEsq/Claude-dashboard-system.git
cd Claude-dashboard-system
bash start.sh
```

The `start.sh` script checks dependencies (Homebrew, Node.js, tmux), installs npm packages, and launches the dashboard.

### Manual installation

```bash
cd csm
npm install
node src/index.js web    # dashboard at http://localhost:9847
```

### Global command (optional)

```bash
cd csm && npm link       # makes 'csm' command available in terminal
csm web                  # now you can do this
```

### tmux setup (optional)

Interactive setup wizard for plugins and sessions:

```bash
bash csm/templates/setup.sh
```

---

## CLI commands

```bash
# Monitoring
csm status                           # all session statuses
csm status --watch                   # auto-refresh every 3 seconds
csm web                              # start web dashboard

# Session management
csm add <name> <tmux-session>        # add session to monitoring
csm add bms bms-session --dir ~/projects/bms
csm remove <name>                    # remove session
csm list                             # list sessions
csm discover                         # find tmux sessions with Claude

# Interaction
csm send <name> <text>               # send text to session
csm focus <name>                     # switch tmux focus

# Configuration
csm config --show                    # show settings
```

---

## Configuration

Settings are stored in `~/.csm/config.json`:

```json
{
  "port": 9847,
  "pollInterval": 3000,
  "historyRetention": 30,
  "alerts": {
    "needsInputTimeout": 300,
    "idleTimeout": 600,
    "tokenThreshold": 80
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `port` | `9847` | Web dashboard port |
| `pollInterval` | `3000` | tmux polling interval (ms) |
| `historyRetention` | `30` | Days to keep history |
| `alerts.needsInputTimeout` | `300` | Seconds before "Needs Input" alert |
| `alerts.idleTimeout` | `600` | Seconds before "Idle" alert |
| `alerts.tokenThreshold` | `80` | Token usage % alert threshold |

---

## API

The web server provides a REST API and WebSocket connection on port `9847`.

### REST

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | All sessions and their state |
| `POST` | `/api/sessions/:name/send` | Send text to session |
| `POST` | `/api/sessions/:name/focus` | Switch tmux focus |
| `POST` | `/api/sessions/create` | Create new session |
| `POST` | `/api/sessions/:name/kill` | Kill session |
| `GET` | `/api/pipeline/:name/wishes` | List wishes |
| `POST` | `/api/pipeline/:name/wishes` | Create wish |
| `POST` | `/api/pipeline/:name/plan` | Run AI planning |
| `POST` | `/api/pipeline/:name/execute` | Execute next task |
| `GET` | `/api/history/:name/status` | Status history (24h) |
| `GET` | `/api/alerts` | Unacknowledged alerts |

### WebSocket

```
ws://localhost:9847
```

Message types: `update`, `statusChange`, `alert`, `taskStarted`, `wishAdded`, `planApplied`.

Full API documentation: [`csm/README.md`](csm/README.md)

---

## Architecture

```
csm/
├── src/
│   ├── index.js              # CLI (commander.js)
│   ├── lib/
│   │   ├── config.js         # Configuration (~/.csm/)
│   │   ├── detector.js       # Status detection via regex
│   │   ├── history.js        # SQLite: logs, tokens, alerts
│   │   ├── monitor.js        # Polling loop, EventEmitter
│   │   ├── pipeline.js       # Wishes → Tasks → Execution
│   │   └── tmux.js           # tmux CLI wrapper
│   └── web/
│       └── server.js         # Express + WebSocket
├── public/                   # SPA dashboard
│   ├── index.html
│   ├── css/                  # Dark theme, CSS Grid
│   └── js/                   # state, api, render, actions, websocket
└── templates/
    ├── setup.sh              # tmux setup wizard
    └── tmux-csm.conf         # Recommended tmux config
```

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express |
| Database | SQLite (better-sqlite3, WAL mode) |
| Real-time | WebSocket (ws) |
| Frontend | Vanilla JS, CSS Grid |
| CLI | commander.js, chalk |
| Terminal | tmux (execSync) |

Data is stored in `~/.csm/`: `config.json`, `history.db`, `pipeline.db`.

---

## License

[MIT](LICENSE)

---

## Contributing

Contributions welcome. Please open an issue first to discuss proposed changes.
