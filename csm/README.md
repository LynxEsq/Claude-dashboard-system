# CSM — Claude Session Manager

Dashboard and CLI for monitoring and managing multiple Claude Code sessions running in tmux.

## What it does

- Real-time status detection for each session (Working, Needs Input, Idle, Error, Offline)
- Web dashboard with live updates via WebSocket
- View terminal output and send input without switching tmux panes
- Token usage tracking with configurable alerts
- **Pipeline**: Inbox (Wishes) → AI Planning → Task Execution
- Auto-discovery of Claude sessions in tmux
- Persistent session mappings with restore after restart
- **Cross-platform**: macOS, Linux, Windows (WSL)
- **Remote access**: auto-detection of local/remote clients, SSH command generation

## Installation

### Requirements

- **Node.js** 18+
- **tmux** 3.0+
- **Claude Code** CLI installed and authenticated

### Option 1: Local machine (macOS / Linux)

```bash
git clone https://github.com/LynxEsq/Claude-dashboard-system.git
cd Claude-dashboard-system

# Auto-install dependencies and launch
./start.sh

# Or manually
cd csm
npm install
node src/index.js web
```

Dashboard opens at http://localhost:9847

### Option 2: Windows (WSL)

```bash
# Inside WSL (Ubuntu/Debian)
git clone https://github.com/LynxEsq/Claude-dashboard-system.git
cd Claude-dashboard-system/csm
npm install

# Local access only (default)
node src/index.js web

# Or allow access from Windows host browser
node src/index.js web --host 0.0.0.0
```

Open `http://localhost:9847` in WSL or `http://<wsl-ip>:9847` from Windows browser.

### Option 3: Remote dev station

Run CSM on your dev server, access dashboard from any device on the network:

```bash
# On the server
node src/index.js web --host 0.0.0.0

# From your laptop — open in browser:
# http://<server-ip>:9847
```

When accessing remotely, the "Terminal" button automatically switches to SSH mode — shows a copyable `ssh -t user@host "tmux attach -t session"` command instead of trying to open a local terminal window.

## Configuration

Stored at `~/.csm/config.json`:

```json
{
  "port": 9847,
  "host": "localhost",
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

| Parameter | Default | Description |
|-----------|---------|-------------|
| `port` | 9847 | Web server port |
| `host` | `localhost` | Bind address. Set to `0.0.0.0` for remote access |
| `pollInterval` | 3000 | tmux polling interval (ms) |
| `historyRetention` | 30 | Days to keep history |
| `alerts.needsInputTimeout` | 300 | Seconds before "needs input" alert |
| `alerts.idleTimeout` | 600 | Seconds before idle alert |
| `alerts.tokenThreshold` | 80 | Token usage % for alert |

> **Security note**: When `host` is set to `0.0.0.0`, the server is accessible from the network without authentication. Use in trusted networks only.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  tmux panes │────▶│  Monitor     │────▶│  WebSocket      │
│  (Claude    │     │  (polling    │     │  broadcast to   │
│   sessions) │     │   every 3s)  │     │  all clients    │
└─────────────┘     └──────┬───────┘     └────────┬────────┘
                           │                      │
                    ┌──────▼───────┐     ┌────────▼────────┐
                    │  SQLite DB   │     │  Web Dashboard   │
                    │  (history,   │     │  (SPA, 4 columns)│
                    │   pipeline)  │     │                  │
                    └──────────────┘     └─────────────────┘
```

### Backend
- **Runtime**: Node.js
- **CLI**: Commander.js (`csm/src/index.js`)
- **Monitor**: EventEmitter, polls tmux panes, detects status via regex
- **Web Server**: Express + WebSocket (ws), REST API + real-time updates
- **Database**: SQLite3 (better-sqlite3, WAL mode)
- **Platform**: Auto-detects macOS, Linux, WSL (`csm/src/lib/platform.js`)

### Frontend
- Vanilla JS SPA, no frameworks
- 4-column layout: **Projects** → **Inbox** → **Tasks** → **Terminal**
- CSS Grid, dark theme
- WebSocket for live updates with auto-reconnect

## CLI Commands

```bash
csm status [--watch]              # Session status (auto-refresh with --watch)
csm add <name> <tmux-session>    # Register session
  [--window W] [--pane P] [--dir PATH]
csm remove <name>                 # Remove session
csm list                          # List all configured sessions
csm web [-p PORT] [-H HOST]      # Start web dashboard
  [--no-open]                     #   --host 0.0.0.0 for remote access
csm send <name> <input...>        # Send text input to session
csm focus <name>                  # Switch tmux focus to session
csm discover [--cleanup]          # Find Claude sessions in tmux
csm config [--show] [--set K=V]   # View/edit configuration
```

### Discover

`csm discover` scans all tmux sessions and identifies ones running Claude Code. With `--cleanup`, it also kills orphaned pipeline sessions (csm-task-\*, csm-plan-\*, csm-exec-\*).

## Web Dashboard

4-column layout:

| Column | Content |
|--------|---------|
| **Projects** | Session list with status indicators, token usage bars, planning state |
| **Inbox** | Textarea for wishes, wish list with edit/delete |
| **Tasks** | Task list by status (pending/running/completed/failed), Plan and Run buttons |
| **Terminal** | Live terminal output, raw key buttons, text input |

### Modals
- **Create Project** — name, project path with directory browser, auto-start Claude option
- **Project Settings** — view/edit name, tmux session, project path; list of all tmux sessions (main + tasks) with status and attach buttons
- **Directory Browser** — navigate filesystem, git repo and CLAUDE.md indicators, double-click to enter directories
- **Add Manual Task** — title, description, priority
- **Permissions** — quick presets + custom permission input
- **SSH Command** (remote) — copyable SSH command to attach to tmux session

### Cross-platform Terminal Button

The "Terminal" button adapts to the environment:

| Platform | Behavior |
|----------|----------|
| **macOS** | Opens Terminal.app with `tmux attach` |
| **WSL** | Opens Windows Terminal (or cmd.exe fallback) |
| **Linux** | Tries gnome-terminal, konsole, xfce4-terminal, xterm |
| **Remote access** | Shows SSH command modal with copy button |

Remote vs local detection is automatic based on client IP address.

## Pipeline System

The pipeline transforms ideas into executed tasks:

```
Wishes (Inbox) ──▶ AI Planning ──▶ Tasks ──▶ Execution
```

### Wishes
Free-form text entries in the Inbox. Multiple wishes can be batched for planning.

### AI Planning
Launches a dedicated Claude session (`csm-plan-{name}`) that reads unprocessed wishes and existing tasks, then outputs a JSON plan with task create/update/delete actions and dependency detection.

### Tasks
Each task has: title, description, status, priority, linked wishes, and optional dependencies (blocked_by).

**Statuses**: `pending` → `running` → `completed` | `failed`

### Task Dependencies
Tasks can depend on other tasks. A task with unresolved blockers is displayed but won't auto-execute until dependencies complete.

### Execution Modes

| Mode | Session Pattern | Description |
|------|----------------|-------------|
| **Interactive** | `csm-task-{name}-{id}` | Dedicated Claude session, pastes prompt via buffer, detects completion |
| **Silent** | `csm-exec-{name}-{id}` | `claude --print --no-session-persistence`, file-based output |
| **Direct** | Main session | Sends prompt to existing Claude session |

### Session Mappings & Restart Recovery
Active task↔tmux session mappings are persisted to SQLite. On server restart, `restoreSessionMappings()` checks which tmux sessions are still alive and restores tracking, or marks tasks as completed if the session is gone.

## Permissions

Read and write `.claude/settings.local.json` for each project to control Claude Code permissions.

```json
{
  "permissions": {
    "allow": ["Bash(npm test)", "Read", "Write"]
  }
}
```

Available via API and dashboard modal with quick presets.

## REST API

Base URL: `http://localhost:9847`

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | All sessions |
| GET | `/api/sessions/:name` | Single session |
| POST | `/api/sessions/create` | Create session + auto-start Claude |
| POST | `/api/sessions/:name/send` | Send text input |
| POST | `/api/sessions/:name/keys` | Send raw tmux keys |
| POST | `/api/sessions/:name/focus` | Switch tmux focus |
| POST | `/api/sessions/:name/terminal` | Open in native terminal (cross-platform) |
| GET | `/api/sessions/:name/tmux-sessions` | List all tmux sessions for project (main + tasks) |
| POST | `/api/sessions/:name/restart` | Ctrl+C + restart Claude |
| POST | `/api/sessions/:name/kill` | Kill tmux session |
| POST | `/api/sessions/:name/destroy` | Full cleanup (kill, remove config, clean DB) |

### Permissions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions/:name/permissions` | Read project permissions |
| POST | `/api/sessions/:name/permissions` | Update project permissions |

### Platform & Access

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/platform` | Server OS and terminal info |
| GET | `/api/access-info` | Local/remote detection, SSH connection details |
| GET | `/api/fs/list?path=...` | Browse directories (for directory picker) |

### History

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/history/:name/status` | Status history (?hours=24) |
| GET | `/api/history/:name/tokens` | Token history (?hours=24) |
| GET | `/api/history/tokens` | All sessions token history |
| GET | `/api/history/:name/timeline` | Session timeline |

### Alerts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/alerts` | Unacknowledged alerts |
| POST | `/api/alerts/:id/acknowledge` | Acknowledge alert |

### Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/config` | Current config |
| POST | `/api/config/session` | Add/update session |
| DELETE | `/api/config/session/:name` | Remove session |

### tmux

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tmux/sessions` | List all tmux sessions (tracked/untracked) |
| POST | `/api/tmux/kill` | Kill specific tmux session |
| POST | `/api/tmux/cleanup-pipeline` | Kill orphaned pipeline sessions |

### Pipeline — Wishes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline/:name/wishes` | Get wishes |
| POST | `/api/pipeline/:name/wishes` | Create wish `{content}` |
| PUT | `/api/pipeline/wishes/:id` | Update wish `{content}` |
| DELETE | `/api/pipeline/wishes/:id` | Delete wish |

### Pipeline — Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline/:name/tasks` | Get tasks (?status=...) |
| POST | `/api/pipeline/:name/tasks` | Create task `{title, description, wishIds, priority, blocked_by}` |
| PUT | `/api/pipeline/tasks/:id` | Update task fields |
| PUT | `/api/pipeline/tasks/:id/status` | Update status `{status, outputSummary}` |
| DELETE | `/api/pipeline/tasks/:id` | Delete task |

### Pipeline — Dependencies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pipeline/tasks/:id/dependencies` | Get blockers and dependents |
| POST | `/api/pipeline/tasks/:id/dependencies` | Set blockers `{blocked_by}` |

### Pipeline — Planning & Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/pipeline/:name/plan` | Start AI planning |
| GET | `/api/pipeline/:name/plan/status` | Check planning progress |
| POST | `/api/pipeline/:name/apply-plan` | Apply plan `{tasksJson, wishIds}` |
| POST | `/api/pipeline/:name/execute` | Execute next pending task (interactive) |
| POST | `/api/pipeline/:name/execute-interactive` | Execute specific task interactively `{taskId}` |
| POST | `/api/pipeline/:name/execute-silent` | Execute specific task silently `{taskId}` |
| GET | `/api/pipeline/:name/task-status/:taskId` | Poll execution status |
| GET | `/api/pipeline/:name/executions` | Execution history |

## WebSocket

Connect to `ws://localhost:9847`

### Server → Client Messages

| Type | Data | Description |
|------|------|-------------|
| `state` | `{sessionName: {...}}` | Full state snapshot on connect |
| `update` | `{name, session}` | Single session updated |
| `statusChange` | `{name, from, to, detail}` | Status transition |
| `alert` | `{...alert}` | New alert |
| `alerts` | `[...alerts]` | Alert list |
| `wishAdded` | `{sessionName, id, content}` | New wish created |
| `planStarted` | `{sessionName, tmuxSession}` | AI planning started |
| `planFinished` | `{sessionName, status}` | AI planning completed |
| `taskCreated` | `{sessionName, id, title, blocked_by}` | New task created |
| `taskStarted` | `{sessionName, taskId, tmuxSession, mode}` | Task execution started |
| `planApplied` | `{sessionName, success, taskIds, tasks}` | Plan applied to tasks |

## Status Detection

Determined via regex patterns in `csm/src/lib/detector.js`:

| Status | Indicators |
|--------|-----------|
| **Working** | Spinner chars (⏳✻⠋-⠏), "Thinking", "Searching", "Reading", "Writing", "Executing" |
| **Needs Input** | Prompt chars (❯$#%), questions, (y/n), "Press Enter", "Allow" |
| **Error** | "Error:", "Failed", rate limits, connection errors, SIGTERM |
| **Idle** | No recent activity |
| **Offline** | tmux session not found |

## Git Worktree Support

Tasks can be isolated in separate git worktrees to avoid conflicts:

- Worktrees stored at `~/.csm/worktrees/task-{taskId}/`
- Branch naming: `csm/task-{taskId}`
- Auto-creation and cleanup

## Data Storage

| File | Location | Content |
|------|----------|---------|
| config.json | `~/.csm/config.json` | Sessions and settings |
| history.db | `~/.csm/history.db` | Status logs, token snapshots, alerts |
| pipeline.db | `~/.csm/pipeline.db` | Wishes, tasks, execution log, dependencies, session mappings |
| worktrees/ | `~/.csm/worktrees/` | Git worktrees for task isolation |

### Database Tables

**history.db**: `status_log`, `token_snapshots`, `alerts`

**pipeline.db**: `wishes`, `tasks`, `execution_log`, `task_dependencies`, `session_mappings`

## Auto-Cleanup

- Old history data pruned daily (configurable retention)
- Orphaned pipeline tmux sessions cleaned every 5 minutes
- On project destroy: all related tmux sessions killed, DB records cleaned

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js |
| CLI | Commander.js |
| Web Server | Express 4 |
| WebSocket | ws |
| Database | better-sqlite3 (WAL mode) |
| Terminal | tmux |
| Frontend | Vanilla JS, CSS Grid |
| Platform | macOS, Linux, WSL |

## License

MIT
