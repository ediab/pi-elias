# pi-elias

One-shot installer for [pi](https://github.com/earendil-works/pi) (the coding-agent harness)
plus Elias's packages and skills. For quickly bootstrapping pi on a new machine.

## What it installs

- **pi harness** — via npm (`@earendil-works/pi-coding-agent`), falling back to the official
  curl installer (`https://pi.dev/install.sh`) if npm fails.
- **16 pi packages** — web-access, codex-goal, pi-notify, mcp-adapter, subagents, pi-pretty,
  ponytail, opencode-theme, plan, btw, compound-engineering, ask-user, lsp, simplify, powerline,
  and `@upstash/context7-pi` (Context7 docs tools + skill).
  Package-installed skills (librarian, ponytail, the `ce-*` suite, `ask-user`, Context7's own
  skill, etc.) come along automatically with their packages — nothing extra to do.
- **3 custom skills** — `handoff`, `grill-me`, `grilling` (bundled in this repo under `skills/`),
  copied to `~/.pi/agent/skills/` (the path pi actually scans).

## What it does NOT install

- MCP servers (`~/.pi/agent/mcp.json`)
- Auth / API keys (`~/.pi/agent/auth.json`)
- Provider / model / theme settings (`~/.pi/agent/settings.json`)

## Usage

Clone and run (recommended — fully self-contained):

```sh
git clone https://github.com/ediab/pi-elias.git
cd pi-elias
./install.sh
```

Or run directly via curl (note: the bundled custom skills won't be present without a clone —
`install.sh` will warn and skip them; clone for the full set):

```sh
curl -fsSL https://raw.githubusercontent.com/ediab/pi-elias/main/install.sh | bash
```

## Updating an existing machine

`install.sh` is a bootstrap — it skips pi when already installed and uses `pi install`
(add), not update. For day-to-day updates use `update.sh`, which runs pi's real updater
and re-syncs the 3 bundled skills:

```sh
./update.sh        # = pi update --all + re-copy custom skills
```
