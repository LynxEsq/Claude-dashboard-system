# CSM — Claude Session Manager

A real-time monitoring and management system for multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions running in tmux. Control all your AI coding sessions from a single web dashboard.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![tmux](https://img.shields.io/badge/tmux-required-1BB91F?logo=tmux&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)

---

## Overview

CSM detects the status of each Claude Code session (Working, Needs Input, Idle, Error) by parsing tmux pane output in real time and surfaces everything through a WebSocket-powered web dashboard. It also provides a task pipeline — from wishes (inbox) to planned tasks to automated execution.

### Key Features

- **Live session monitoring** — polls tmux panes every 3 seconds, detects Claude's state via pattern matching
- **Web dashboard** — multi-column SPA with projects, inbox, tasks, and terminal panels
- **WebSocket updates** — instant status changes, alerts, and task events pushed to the browser
- **Task pipeline** — Wishes → Planning → Tasks → Execution workflow for each project
- **Token tracking** — real-time token usage with percentage bars and threshold alerts
- **Session control** — create, kill, focus, and send input to sessions from the dashboard
- **Alerts** — configurable timeouts for "Needs Input" and "Idle" states
- **tmux integration** — one-click focus switching, recommended tmux config with plugin support

---

## Dashboard

The web interface runs on `http://localhost:9847` and provides:

| Column | Description |
|--------|-------------|
| **Projects** | Session cards with live status, token usage, and quick actions |
| **Inbox** | Wishes (requests) per project — your backlog of ideas |
| **Tasks** | Planned and prioritized tasks generated from wishes |
| **Terminal** | Live output preview (200 lines) with key-sending capability |

### Status Detection

| Status | Indicator | Detected Patterns |
|--------|-----------|-------------------|
| **Working** | Yellow | Spinners, "thinking", tool use indicators |
| **Needs Input** | Blue | `>` prompt, `?`, `(y/n)`, shell prompts |
| **Error** | Red | "Error:", "Failed", "rate limit" |
| **Idle** | Grey | No recent activity |
| **Offline** | Dark | tmux session not found |

---

## Requirements

- **Node.js** 18+
- **tmux** (installed and running)
- **macOS** or **Linux**

---

## Installation

### Quick Start

```bash
git clone https://github.com/your-username/claude-session-manager.git
cd claude-session-manager/csm
bash ../start.sh
```

The `start.sh` script checks dependencies, installs npm packages, and launches the web dashboard.

### Manual Installation

```bash
cd csm
npm install
npm link          # makes 'csm' command available globally
```

### tmux Setup (optional)

Run the interactive setup wizard to configure tmux plugins and register project sessions:

```bash
bash templates/setup.sh
```

Or apply the recommended tmux config manually:

```bash
cp templates/tmux-csm.conf ~/.tmux-csm.conf
echo 'source-file ~/.tmux-csm.conf' >> ~/.tmux.conf
tmux source-file ~/.tmux.conf
```

---

## Usage

### CLI Commands

```bash
csm web                              # Start web dashboard (localhost:9847)
csm status                           # Show all session statuses
csm status --watch                   # Auto-refresh every 3 seconds

csm add <name> <tmux-session>        # Register a session to monitor
csm add bms bms-session --dir ~/projects/bms
csm remove <name>                    # Unregister a session
csm list                             # List configured sessions
csm discover                         # Find available tmux sessions

csm send <name> <text>               # Send input to a session
csm focus <name>                     # Switch tmux focus to a session
csm config --show                    # Display current configuration
```

### npm Scripts

```bash
npm start        # Run CLI
npm run web      # Start web dashboard
npm run dev      # Web dashboard (development mode)
```

---

## Configuration

CSM stores its config in `~/.csm/config.json`:

```json
{
  "port": 9847,
  "pollInterval": 3000,
  "historyRetention": 30,
  "alerts": {
    "needsInputTimeout": 300,
    "idleTimeout": 600,
    "tokenThreshold": 80
  },
  "sessions": []
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `port` | `9847` | Web dashboard port |
| `pollInterval` | `3000` | Polling interval in ms |
| `historyRetention` | `30` | Days to keep history |
| `alerts.needsInputTimeout` | `300` | Seconds before "Needs Input" alert |
| `alerts.idleTimeout` | `600` | Seconds before "Idle" alert |
| `alerts.tokenThreshold` | `80` | Token usage % alert threshold |

---

## Architecture

```
csm/
├── src/
│   ├── index.js              # CLI entry point (commander.js)
│   ├── lib/
│   │   ├── config.js         # Config management (~/.csm/)
│   │   ├── detector.js       # Status detection via regex patterns
│   │   ├── history.js        # SQLite logging & alerts
│   │   ├── monitor.js        # Polling loop & event emitter
│   │   ├── pipeline.js       # Wishes/Tasks/Execution pipeline
│   │   └── tmux.js           # tmux command interface
│   └── web/
│       └── server.js         # Express + WebSocket server
├── public/                   # Dashboard SPA
│   ├── index.html
│   ├── css/
│   └── js/
│       ├── state.js          # Centralized app state
│       ├── api.js            # REST API client
│       ├── render.js         # UI rendering
│       ├── actions.js        # Event handlers
│       └── websocket.js      # WebSocket client
└── templates/
    ├── CLAUDE.md             # Project context template
    ├── setup.sh              # Interactive setup wizard
    └── tmux-csm.conf         # Recommended tmux config
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express |
| Database | SQLite (better-sqlite3) |
| Real-time | WebSocket (ws) |
| Frontend | Vanilla JS, CSS (dark theme) |
| CLI | commander.js |
| Terminal | tmux (via execSync) |

---

## API

The web server exposes REST endpoints and a WebSocket connection.

### REST Endpoints

**Sessions**
- `GET /api/sessions` — all session states
- `GET /api/sessions/:name` — single session
- `POST /api/sessions/:name/send` — send text input
- `POST /api/sessions/:name/focus` — switch tmux focus
- `POST /api/sessions/:name/keys` — send raw tmux keys
- `POST /api/sessions/create` — create new session
- `POST /api/sessions/:name/kill` — kill session

**Pipeline**
- `GET /api/pipeline/:name/wishes` — list wishes
- `POST /api/pipeline/:name/wishes` — create wish
- `GET /api/pipeline/:name/tasks` — list tasks
- `POST /api/pipeline/:name/tasks` — create task
- `POST /api/pipeline/:name/plan` — AI planning (wishes → tasks)
- `POST /api/pipeline/:name/execute` — execute next pending task

**History & Alerts**
- `GET /api/history/:name/status` — status history (24h)
- `GET /api/history/:name/tokens` — token usage history
- `GET /api/alerts` — unacknowledged alerts

### WebSocket

Connect to `ws://localhost:9847`. Messages are JSON with `type` field:

- `update` — periodic state broadcast
- `statusChange` — session status changed
- `alert` — new alert triggered
- `taskStarted` — task execution began

---

## Task Pipeline

CSM provides a structured workflow to manage work across projects:

1. **Wishes (Inbox)** — Write requests and ideas for a project
2. **Planning** — AI analyzes wishes and generates actionable tasks
3. **Tasks** — Prioritized, focused units of work
4. **Execution** — Tasks run one by one, each in its own Claude session

This pipeline lets you batch ideas, plan them in bulk, and execute systematically.

---

## Data Storage

CSM uses two SQLite databases stored in `~/.csm/`:

| Database | Purpose |
|----------|---------|
| `history.db` | Status logs, token snapshots, alerts |
| `pipeline.db` | Wishes, tasks, execution logs |

---

## License

[MIT](LICENSE)

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.
