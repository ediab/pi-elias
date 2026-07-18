# pi-elias

One-shot installer for [pi](https://github.com/earendil-works/pi) (the coding-agent harness)
plus Elias's packages and skills. For quickly bootstrapping pi on a new machine.

## What it installs

- **pi harness** — via npm (`@earendil-works/pi-coding-agent`), falling back to the official
  curl installer (`https://pi.dev/install.sh`) if npm fails.
- **15 pi packages** — web-access, codex-goal, pi-notify, mcp-adapter, subagents, pi-pretty,
  ponytail, opencode-theme, plan, btw, compound-engineering, ask-user, lsp, simplify, powerline.
- **skills** — `context7-mcp` (bundled here) and `superpowers` (cloned from `obra/superpowers`).

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

Or run directly via curl (fetches the bundled skill from this repo):

```sh
curl -fsSL https://raw.githubusercontent.com/ediab/pi-elias/main/install.sh | bash
```
