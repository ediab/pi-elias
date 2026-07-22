#!/usr/bin/env bash
# pi-elias — install the pi coding-agent harness + Elias's packages + skills.
# Does NOT install MCPs, auth keys, or provider/model settings.
set -euo pipefail

PACKAGES=(
  npm:pi-web-access
  npm:@yusukeshib/pi-notify
  npm:pi-mcp-adapter
  npm:pi-subagents
  npm:@heyhuynhgiabuu/pi-pretty
  npm:@dietrichgebert/ponytail
  npm:pi-claude-cli
  npm:pi-compound-engineering
  npm:pi-ask-user
  npm:pi-lsp
  npm:pi-simplify
  npm:@juicesharp/rpiv-btw
  npm:@juicesharp/rpiv-advisor
  npm:pi-caveman
  npm:@juicesharp/rpiv-todo
  git:github.com/victor-software-house/pi-curated-themes
)

# Custom (non-package) skills bundled in this repo.
CUSTOM_SKILLS=(handoff grill-me grilling)

# Custom extensions bundled in this repo (single-file .ts -> ~/.pi/agent/extensions/).
CUSTOM_EXTENSIONS=(clear exit no-footer statusline)
# Custom directory extensions bundled in this repo (dir with index.ts -> ~/.pi/agent/extensions/<name>/).
CUSTOM_EXTENSION_DIRS=(plan-mode)

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

# lefthook: required by pi-curated-themes' npm prepare script.
if ! command -v lefthook >/dev/null 2>&1 && command -v brew >/dev/null 2>&1; then
  echo "    installing lefthook (needed by pi-curated-themes)..."
  brew install lefthook || echo "    warn: lefthook install failed — pi-curated-themes may fail"
fi

echo "==> 2/3  packages (${#PACKAGES[@]} total)"
for pkg in "${PACKAGES[@]}"; do
  pi install "$pkg" || echo "  FAILED: $pkg  (rerun: pi install $pkg)"
done

echo "==> 3/3  custom skills (${#CUSTOM_SKILLS[@]} total) + extensions (${#CUSTOM_EXTENSIONS[@]} total) + AGENTS.md seed"
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
for ext in "${CUSTOM_EXTENSION_DIRS[@]}"; do
  src="$SCRIPT_DIR/extensions/$ext"
  if [ ! -d "$src" ]; then
    echo "  MISSING: $ext (no $src/) — clone the repo instead of curl|bash"
    continue
  fi
  mkdir -p "$PI_EXTENSIONS_DIR/$ext"
  cp -R "$src/". "$PI_EXTENSIONS_DIR/$ext/"
  echo "    $ext/  installed"
done

# Seed ~/.pi/agent/AGENTS.md from the sanitized repo copy. Only when absent — never clobber
# local-only sections like VPS access details.
if [ ! -f "$HOME/.pi/agent/AGENTS.md" ] && [ -f "$SCRIPT_DIR/AGENTS.md" ]; then
  cp "$SCRIPT_DIR/AGENTS.md" "$HOME/.pi/agent/AGENTS.md"
  echo "    AGENTS.md  seeded (add any local-only sections, e.g. VPS access, manually)"
else
  echo "    AGENTS.md  already present — left untouched (local edits preserved)"
fi

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
for ext in "${CUSTOM_EXTENSION_DIRS[@]}"; do
  [ -f "$HOME/.pi/agent/extensions/$ext/index.ts" ] && echo "    ok: $ext/" || echo "    MISSING: $ext"
done
[ -f "$HOME/.pi/agent/AGENTS.md" ] && echo "    ok: AGENTS.md" || echo "    MISSING: AGENTS.md"

echo "==> done."
echo "    MCPs and auth keys were NOT installed — configure those separately."
