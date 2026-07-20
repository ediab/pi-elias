#!/usr/bin/env bash
# pi-elias — update pi + all installed packages, and re-sync bundled custom skills.
# For day-to-day updates on a machine already bootstrapped by install.sh.
# New machine? Use install.sh instead.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PI_SKILLS_DIR="$HOME/.pi/agent/skills"
PI_EXTENSIONS_DIR="$HOME/.pi/agent/extensions"
CUSTOM_SKILLS=(handoff grill-me grilling)
CUSTOM_EXTENSIONS=(clear exit)

echo "==> 1/2  pi + packages"
pi update --all

echo "==> 2/2  custom skills (${#CUSTOM_SKILLS[@]} total) + extensions (${#CUSTOM_EXTENSIONS[@]} total)"
mkdir -p "$PI_SKILLS_DIR"
for skill in "${CUSTOM_SKILLS[@]}"; do
  src="$SCRIPT_DIR/skills/$skill/SKILL.md"
  if [ ! -f "$src" ]; then
    echo "  MISSING: $skill (no $src) — run from a clone of the repo"
    continue
  fi
  mkdir -p "$PI_SKILLS_DIR/$skill"
  cp "$src" "$PI_SKILLS_DIR/$skill/SKILL.md"
  echo "    $skill  re-synced"
done

mkdir -p "$PI_EXTENSIONS_DIR"
for ext in "${CUSTOM_EXTENSIONS[@]}"; do
  src="$SCRIPT_DIR/extensions/$ext.ts"
  if [ ! -f "$src" ]; then
    echo "  MISSING: $ext (no $src) — run from a clone of the repo"
    continue
  fi
  cp "$src" "$PI_EXTENSIONS_DIR/$ext.ts"
  echo "    $ext  re-synced"
done

echo "==> done."
