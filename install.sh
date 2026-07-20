#!/usr/bin/env bash
# pi-elias — install the pi coding-agent harness + Elias's packages + skills.
# Does NOT install MCPs, auth keys, or provider/model settings.
set -euo pipefail

PACKAGES=(
  npm:pi-web-access
  npm:pi-codex-goal
  npm:@yusukeshib/pi-notify
  npm:pi-mcp-adapter
  npm:pi-subagents
  npm:@heyhuynhgiabuu/pi-pretty
  npm:@dietrichgebert/ponytail
  npm:pi-opencode-theme
  npm:pi-btw
  npm:pi-compound-engineering
  npm:pi-ask-user
  npm:pi-lsp
  npm:pi-simplify
  npm:pi-powerline
  npm:@upstash/context7-pi
)

# Custom (non-package) skills bundled in this repo.
CUSTOM_SKILLS=(handoff grill-me grilling)

# Custom extensions bundled in this repo (single-file .ts -> ~/.pi/agent/extensions/).
CUSTOM_EXTENSIONS=(clear exit)

# Resolve the repo root (works for clone+run and curl|bash via $0).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PI_SKILLS_DIR="$HOME/.pi/agent/skills"   # note: 'agent' singular — the path pi scans

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

echo "==> 3/3  custom skills (${#CUSTOM_SKILLS[@]} total) + extensions (${#CUSTOM_EXTENSIONS[@]} total)"
mkdir -p "$PI_SKILLS_DIR"
for skill in "${CUSTOM_SKILLS[@]}"; do
  src="$SCRIPT_DIR/skills/$skill/SKILL.md"
  if [ ! -f "$src" ]; then
    echo "  MISSING: $skill (no $src) — clone the repo instead of curl|bash, or add the skill"
    continue
  fi
  mkdir -p "$PI_SKILLS_DIR/$skill"
  cp "$src" "$PI_SKILLS_DIR/$skill/SKILL.md"
  echo "    $skill  installed"
done

PI_EXTENSIONS_DIR="$HOME/.pi/agent/extensions"
mkdir -p "$PI_EXTENSIONS_DIR"
for ext in "${CUSTOM_EXTENSIONS[@]}"; do
  src="$SCRIPT_DIR/extensions/$ext.ts"
  if [ ! -f "$src" ]; then
    echo "  MISSING: $ext (no $src) — clone the repo instead of curl|bash"
    continue
  fi
  cp "$src" "$PI_EXTENSIONS_DIR/$ext.ts"
  echo "    $ext  installed"
done

echo "==> verify"
command -v pi >/dev/null 2>&1 && echo "    pi: $(pi --version)" || echo "    pi: MISSING"
echo "    packages:"
pi list 2>/dev/null || echo "    pi list failed"
for skill in "${CUSTOM_SKILLS[@]}"; do
  [ -f "$PI_SKILLS_DIR/$skill/SKILL.md" ] && echo "    ok: $skill" || echo "    MISSING: $skill"
done
for ext in "${CUSTOM_EXTENSIONS[@]}"; do
  [ -f "$HOME/.pi/agent/extensions/$ext.ts" ] && echo "    ok: $ext" || echo "    MISSING: $ext"
done

echo "==> done."
echo "    MCPs and auth keys were NOT installed — configure those separately."
