#!/usr/bin/env bash
# pi-elias — install the pi coding-agent harness + Elias's packages + skills.
# Does NOT install MCPs, auth keys, or provider/model settings.
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/ediab/pi-elias/main"

PACKAGES=(
  npm:pi-web-access
  npm:pi-codex-goal
  npm:@yusukeshib/pi-notify
  npm:pi-mcp-adapter
  npm:pi-subagents
  npm:@heyhuynhgiabuu/pi-pretty
  npm:@dietrichgebert/ponytail
  npm:pi-opencode-theme
  npm:pi-plan
  npm:pi-btw
  npm:pi-compound-engineering
  npm:pi-ask-user
  npm:pi-lsp
  npm:pi-simplify
  npm:pi-powerline
)

SKILLS_DIR="$HOME/.agents/skills"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 1/3  pi harness"
if command -v pi >/dev/null 2>&1; then
  echo "    pi already installed ($(pi --version 2>/dev/null || echo unknown)); skipping"
else
  echo "    installing via npm..."
  if ! npm install -g --ignore-scripts @earendil-works/pi-coding-agent; then
    echo "    npm failed; falling back to curl installer..."
    curl -fsSL https://pi.dev/install.sh | sh
  fi
  command -v pi >/dev/null 2>&1 || { echo "    ERROR: pi still not on PATH"; exit 1; }
fi

echo "==> 2/3  packages (${#PACKAGES[@]} total)"
for pkg in "${PACKAGES[@]}"; do
  pi install "$pkg" || echo "  FAILED: $pkg  (rerun: pi install $pkg)"
done

echo "==> 3/3  skills"
mkdir -p "$SKILLS_DIR"

# context7-mcp: standalone skill file (no upstream repo). Use the local copy
# when running from a clone, otherwise fetch it from this repo's raw URL.
mkdir -p "$SKILLS_DIR/context7-mcp"
if [ -f "$SCRIPT_DIR/skills/context7-mcp/SKILL.md" ]; then
  cp "$SCRIPT_DIR/skills/context7-mcp/SKILL.md" "$SKILLS_DIR/context7-mcp/SKILL.md"
else
  curl -fsSL "$REPO_RAW/skills/context7-mcp/SKILL.md" -o "$SKILLS_DIR/context7-mcp/SKILL.md"
fi
echo "    context7-mcp  installed"

# superpowers: upstream git repo, symlinked into the skills dir.
mkdir -p "$HOME/.codex"
if [ ! -d "$HOME/.codex/superpowers/.git" ]; then
  git clone --depth 1 https://github.com/obra/superpowers.git "$HOME/.codex/superpowers"
fi
if [ -L "$SKILLS_DIR/superpowers" ] || [ ! -e "$SKILLS_DIR/superpowers" ]; then
  ln -sfn "$HOME/.codex/superpowers/skills" "$SKILLS_DIR/superpowers"
  echo "    superpowers  cloned + linked"
else
  echo "    superpowers  skipped ($SKILLS_DIR/superpowers exists and is not a symlink)"
fi

echo "==> verify"
command -v pi >/dev/null 2>&1 && echo "    pi: $(pi --version)" || echo "    pi: MISSING"
[ -f "$SKILLS_DIR/context7-mcp/SKILL.md" ] && echo "    ok: context7-mcp skill" || echo "    MISSING: context7-mcp"
[ -L "$SKILLS_DIR/superpowers" ] && echo "    ok: superpowers skill" || echo "    MISSING: superpowers"

echo "==> done."
echo "    MCPs and auth keys were NOT installed — configure those separately."
