#!/bin/bash
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CSM_DIR="$SCRIPT_DIR/csm"

echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo -e "${CYAN}  Claude Session Manager — Launcher${NC}"
echo -e "${CYAN}══════════════════════════════════════════${NC}"
echo

# ─── Check & install Homebrew ────────────────────────────

if ! command -v brew &>/dev/null; then
  echo -e "${YELLOW}Installing Homebrew...${NC}"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
  echo -e "${GREEN}✓ Homebrew installed${NC}"
else
  echo -e "${GREEN}✓ Homebrew OK${NC}"
fi

# ─── Check & install dependencies ───────────────────────

if ! command -v node &>/dev/null; then
  echo -e "${YELLOW}Installing Node.js...${NC}"
  brew install node
  echo -e "${GREEN}✓ Node.js installed${NC}"
else
  echo -e "${GREEN}✓ Node.js $(node -v)${NC}"
fi

if ! command -v tmux &>/dev/null; then
  echo -e "${YELLOW}Installing tmux...${NC}"
  brew install tmux
  echo -e "${GREEN}✓ tmux installed${NC}"
else
  echo -e "${GREEN}✓ tmux $(tmux -V)${NC}"
fi

# ─── Ensure tmux server is running ───────────────────────

if ! tmux list-sessions &>/dev/null; then
  echo -e "${YELLOW}Starting tmux server...${NC}"
  tmux new-session -d -s csm-init && tmux kill-session -t csm-init 2>/dev/null
  echo -e "${GREEN}✓ tmux server started${NC}"
else
  echo -e "${GREEN}✓ tmux server running${NC}"
fi

# ─── Install npm dependencies ───────────────────────────

cd "$CSM_DIR"

if [ ! -d node_modules ] || [ package.json -nt node_modules/.package-lock.json ]; then
  echo -e "\n${YELLOW}Installing npm dependencies...${NC}"
  npm install
  echo -e "${GREEN}✓ Dependencies installed${NC}"
else
  echo -e "${GREEN}✓ Dependencies up to date${NC}"
fi

# ─── Ensure better-sqlite3 native module is built ───────
# Native modules may need rebuilding on different machines

if ! node -e "require('better-sqlite3')" 2>/dev/null; then
  echo -e "${YELLOW}Building better-sqlite3 native module...${NC}"
  npm rebuild better-sqlite3 2>&1
  if ! node -e "require('better-sqlite3')" 2>/dev/null; then
    echo -e "${YELLOW}Reinstalling better-sqlite3...${NC}"
    rm -rf node_modules/better-sqlite3
    npm install better-sqlite3
  fi
  echo -e "${GREEN}✓ better-sqlite3 ready${NC}"
else
  echo -e "${GREEN}✓ better-sqlite3 OK${NC}"
fi

# ─── Launch ──────────────────────────────────────────────

echo
echo -e "${CYAN}Starting CSM web dashboard...${NC}"
echo -e "${CYAN}Dashboard: http://localhost:9847${NC}"
echo -e "${CYAN}Press Ctrl+C to stop${NC}"
echo

exec node src/index.js web
