# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Be Brief

**Default to terse. Code first, prose second.**

- Drop filler, hedging, and pleasantries. Fragments are fine.
- State what changed and why. Cut anything else.
- Explanation you were asked for (a report, walkthrough, per-phase notes) is not debt — give it in full.
- Code blocks, errors, and commands stay exact.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
---

## Tech Documentation Lookups

Use the `context7` MCP server for library/API documentation — it returns current, version-pinned docs, so it's more accurate than web search or guessing from memory.

Flow: `mcp({ tool: "context7_resolve-library-id", args: '{"libraryName": "react"}' })` to get a library ID, then `mcp({ tool: "context7_query-docs", args: '{"libraryId": ".../react", "topic": "hooks"}' })` for up-to-date docs. Prefer this for exact API signatures, current options, and version-pinned behavior.

## Custom pi commands

Slash commands added via extensions in `~/dev/pi-elias/extensions/` (synced to `~/.pi/agent/extensions/` by `install.sh`/`update.sh`):

- `/clear` — clear the conversation, start a fresh session (alias for `/new`)
- `/exit` — quit pi (alias for `/quit`)

## pi-elias sync

When you make changes to the pi harness setup (custom extensions, skills, installer), update `~/dev/pi-elias` so they're captured for reinstall on other machines. Run `~/dev/pi-elias/update.sh` to re-sync bundled skills and extensions to `~/.pi/agent/`.

**Keep pi-elias in sync with the live harness:** whenever you install/remove a package, edit `~/.pi/agent/settings.json`, or add/edit a skill or extension, mirror that change in `~/dev/pi-elias` (`install.sh` PACKAGES list, `settings.json`, `skills/`, `extensions/`) so other machines reinstall identically.

---

## Documented Solutions

`docs/solutions/` — documented solutions to past problems (bugs, best practices, workflow patterns, tooling decisions), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). Relevant when implementing or debugging in documented areas.
`CONCEPTS.md` — shared domain vocabulary (entities, named processes, status concepts) — relevant when orienting to the codebase or discussing domain concepts.

---

_Note: machine-specific sections (e.g. VPS access details) are kept local-only in `~/.pi/agent/AGENTS.md` and intentionally not committed to this public repo. `install.sh` seeds this file only when it's absent, so it never clobbers those local additions. On a new machine, re-add them manually after running `install.sh`._

<!-- BEGIN COMPOUND PI TOOL MAP -->
## Compound Engineering (Pi compatibility)

This block is added by the pi-compound-engineering package.

Pi extensions used by skills shipped by this package:
- Required for full functionality: `pi-subagents` (by nicobailon) provides the `subagent` tool used by ce-compound, ce-code-review, ce-plan, ce-compound-refresh, and other parallel-agent skills.
- Recommended: `pi-ask-user` (by edlsh) provides the `ask_user` tool; skills fall back to numbered options in chat when it is missing.

Install with:
  pi install npm:pi-subagents
  pi install npm:pi-ask-user
<!-- END COMPOUND PI TOOL MAP -->
