# CSM — Claude Session Manager

Monitor and manage multiple Claude Code sessions running in tmux from one place.

```
┌─────────────────┐    ┌──────────────────────────────┐
│ iTerm2           │    │ Chrome: localhost:9847        │
│                  │    │                              │
│ tmux: bms        │    │  BMS          ● Working      │
│ tmux: clawhost   │    │  ClawHost     ▲ Needs Input  │
│ tmux: archfin    │    │  Archfinance  ○ Idle         │
│                  │    │                              │
│                  │    │  Tokens: ████░░  67%         │
└─────────────────┘    └──────────────────────────────┘
```

## Features

- **Real-time status detection** — parses tmux pane output to determine if Claude is Working, Needs Input, Idle, or has Errors
- **Web dashboard** (`csm --web`) on `localhost:9847` with WebSocket live updates
- **Live output** — see the last lines of each session's terminal
- **Send input** — type responses to Claude directly from the dashboard
- **Token tracking** — monitors token usage with charts and threshold alerts
- **Status history** — timeline of status changes over 24h
- **Alerts** — notifies when sessions are stuck waiting for input, idle too long, or tokens are running low
- **tmux integration** — one-click focus to switch to a session, tmux-resurrect support
- **Session discovery** — auto-find tmux sessions that might be running Claude

## Quick Start

```bash
# Install
cd csm
npm install
npm link    # makes 'csm' available globally

# Add sessions
csm add bms my-bms-tmux-session
csm add claw claw-session --window 0 --pane 1
csm add archfin archfin-session --dir ~/projects/archfin

# Check status
csm status
csm status --watch    # auto-refresh every 3s

# Open web dashboard
csm web
# or
csm --web
```

## CLI Commands

| Command | Description |
|---|---|
| `csm status` | Show all session statuses |
| `csm status --watch` | Watch mode with auto-refresh |
| `csm web` | Start web dashboard |
| `csm add <name> <tmux-session>` | Add a session to monitor |
| `csm remove <name>` | Remove a session |
| `csm list` | List configured sessions |
| `csm discover` | Find available tmux sessions |
| `csm send <name> <text>` | Send input to a session |
| `csm focus <name>` | Switch tmux focus to a session |
| `csm config --show` | Show configuration |

## Web Dashboard

The dashboard at `localhost:9847` provides:

1. **Session cards** — status, detail, token usage bar, quick actions
2. **Live output panel** — real-time terminal output for selected session
3. **Input panel** — send text input to Claude without switching tmux
4. **Token chart** — 24h token usage graph
5. **Status timeline** — visual timeline of status changes
6. **Alerts** — notifications for timeouts and thresholds

## Setup with tmux-resurrect

Run the included setup script to install tmux-resurrect/continuum and configure your sessions:

```bash
./templates/setup.sh
```

This will:
- Install tmux-resurrect and tmux-continuum plugins
- Add CSM tmux keybindings
- Interactively create tmux sessions for your projects
- Register them with CSM

## Configuration

Config is stored in `~/.csm/config.json`:

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
  "sessions": [
    {
      "name": "bms",
      "tmuxSession": "bms",
      "tmuxWindow": null,
      "tmuxPane": null,
      "projectPath": "/path/to/bms"
    }
  ]
}
```

## How Status Detection Works

CSM captures the last 50 lines of each tmux pane every 3 seconds and matches against patterns:

- **Working** — spinner characters, "Thinking", "Running", "Writing", tool use indicators
- **Needs Input** — prompt characters (`>`, `❯`, `$`), questions, y/n prompts
- **Error** — "Error:", "Failed", rate limit messages
- **Idle** — no recent activity patterns
- **Offline** — tmux session not found

## Project Structure

```
csm/
├── src/
│   ├── index.js           # CLI entry point (commander)
│   ├── lib/
│   │   ├── config.js      # Config management (~/.csm/)
│   │   ├── tmux.js        # tmux interaction (capture-pane, send-keys)
│   │   ├── detector.js    # Status detection from pane output
│   │   ├── history.js     # SQLite history & alerts
│   │   └── monitor.js     # Main polling loop & event emitter
│   └── web/
│       └── server.js      # Express + WebSocket server
├── public/
│   └── index.html         # Dashboard SPA
├── templates/
│   ├── CLAUDE.md          # CLAUDE.md template for projects
│   ├── tmux-csm.conf      # Recommended tmux config
│   └── setup.sh           # Quick setup script
├── package.json
└── README.md
```

## License

MIT
