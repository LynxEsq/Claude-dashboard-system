#!/bin/bash
# CSM Quick Setup — sets up tmux sessions for your Claude Code projects
# Usage: ./setup.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Claude Session Manager — Quick Setup    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo

# 1. Install tmux-resurrect if not present
if [ ! -d "$HOME/.tmux/plugins/tmux-resurrect" ]; then
  echo -e "${YELLOW}Installing tmux-resurrect...${NC}"
  mkdir -p ~/.tmux/plugins
  git clone https://github.com/tmux-plugins/tmux-resurrect ~/.tmux/plugins/tmux-resurrect
  echo -e "${GREEN}✓ tmux-resurrect installed${NC}"
else
  echo -e "${GREEN}✓ tmux-resurrect already installed${NC}"
fi

# 2. Install tmux-continuum if not present
if [ ! -d "$HOME/.tmux/plugins/tmux-continuum" ]; then
  echo -e "${YELLOW}Installing tmux-continuum...${NC}"
  git clone https://github.com/tmux-plugins/tmux-continuum ~/.tmux/plugins/tmux-continuum
  echo -e "${GREEN}✓ tmux-continuum installed${NC}"
else
  echo -e "${GREEN}✓ tmux-continuum already installed${NC}"
fi

# 3. Copy tmux config
echo -e "${YELLOW}Setting up tmux config...${NC}"
mkdir -p ~/.config/csm
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/tmux-csm.conf" ~/.config/csm/tmux-csm.conf

if ! grep -q "source-file.*csm/tmux-csm.conf" ~/.tmux.conf 2>/dev/null; then
  echo "" >> ~/.tmux.conf
  echo "# Claude Session Manager integration" >> ~/.tmux.conf
  echo "source-file ~/.config/csm/tmux-csm.conf" >> ~/.tmux.conf
  echo -e "${GREEN}✓ Added CSM config to .tmux.conf${NC}"
else
  echo -e "${GREEN}✓ CSM config already in .tmux.conf${NC}"
fi

# 4. Interactive: create tmux sessions for projects
echo
echo -e "${CYAN}Let's set up your Claude Code project sessions.${NC}"
echo -e "${CYAN}Enter project details (empty name to finish):${NC}"
echo

while true; do
  read -p "  Project name (e.g., bms): " NAME
  [ -z "$NAME" ] && break

  read -p "  Project path: " PROJECT_PATH
  read -p "  Auto-start 'claude' in this session? (y/n) [y]: " AUTO_CLAUDE
  AUTO_CLAUDE=${AUTO_CLAUDE:-y}

  # Create tmux session
  if tmux has-session -t "$NAME" 2>/dev/null; then
    echo -e "  ${YELLOW}tmux session '$NAME' already exists${NC}"
  else
    tmux new-session -d -s "$NAME" -c "$PROJECT_PATH"
    if [ "$AUTO_CLAUDE" = "y" ]; then
      tmux send-keys -t "$NAME" "claude" Enter
    fi
    echo -e "  ${GREEN}✓ Created tmux session: $NAME${NC}"
  fi

  # Register with CSM
  csm add "$NAME" "$NAME" --dir "$PROJECT_PATH" 2>/dev/null || true
  echo -e "  ${GREEN}✓ Registered with CSM${NC}"
  echo
done

echo
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Setup complete!                         ║${NC}"
echo -e "${GREEN}║                                          ║${NC}"
echo -e "${GREEN}║  Commands:                               ║${NC}"
echo -e "${GREEN}║    csm status      — view all sessions   ║${NC}"
echo -e "${GREEN}║    csm --web       — open dashboard      ║${NC}"
echo -e "${GREEN}║    csm discover    — find tmux sessions   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
