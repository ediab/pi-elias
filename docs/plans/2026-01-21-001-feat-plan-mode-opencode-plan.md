---
title: opencode-style Plan Mode Extension - Plan
type: feat
date: 2026-01-21
topic: plan-mode-opencode
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

## Goal Capsule

- **Objective:** Add an opencode-style read-only plan mode to the pi harness, toggled with Ctrl+Shift+L, ending in a done-menu that offers inline execution, two subagent execution paths, or a `ce-plan` handoff.
- **Product authority:** elias (pi-elias harness owner).
- **Execution profile:** code — a pi extension plus a keybindings change, both tracked in `pi-elias`.
- **Open blockers:** none.
- **Tail ownership:** implemented and maintained as `extensions/plan-mode/` in this repo, synced to `~/.pi/agent/extensions/`.

---

## Product Contract

### Summary

Ship a pi extension that adapts pi's shipped `plan-mode/` example into an opencode-style plan mode: Ctrl+Shift+L toggles a read-only exploration phase, and extracting a `Plan:` ends in a six-option menu covering inline execution, two subagent routes, and a `ce-plan` write path. Tab stays on autocomplete; no keybindings rebind is required.

### Problem Frame

The pi harness ships a `plan-mode/` extension example that already enforces read-only exploration, extracts numbered plans, and tracks `[DONE:n]` completion. It does not match opencode's one-key feel (it toggles on `Ctrl+Alt+P`), does not offer subagent execution, and does not hand off to the compound-engineering planning skills (`ce-plan`, `ce-work`). The gap is a harness-wide mode that combines opencode's Tab-toggle UX with the `ce-*` execution pipeline.

### Key Decisions

- **Ctrl+Shift+L is the toggle; no keybindings change.** `tab` is pi's autocomplete default, `ctrl+p` is reserved (model cycle + path toggle), and `ctrl+alt+p` is awkward on macOS without "Option as Meta", so the extension shortcut uses `ctrl+shift+l`, which is free by default and works cross-platform.
- **Two distinct subagent paths at done-time, chosen live.** "Subagents via ce-plan → ce-work" persists and enriches the plan in `docs/plans/` before execution; "Subagents direct dispatch" fans steps straight to the `subagent` tool with no doc. Both offered; not collapsed.
- **Recommendation comes from the agent, not a heuristic.** Plan-mode context instructs the agent to end its plan with `Recommended execution: inline | subagents`; the extension parses it and marks the matching menu option. Absent line defaults to inline.
- **Re-use the shipped example's machinery.** `utils.ts` (bash allowlist, `extractTodoItems`, `markCompletedSteps`) is reused unchanged; only `index.ts` changes substantially.

### Requirements

**Toggle and keys**

- R1. Ctrl+Shift+L toggles plan mode on and off via a registered extension shortcut.
- R2. `/plan` command and `--plan` flag remain as secondary toggles.
- R3. Tab remains bound to autocomplete (pi default); no `keybindings.json` change is required.

**Read-only enforcement (plan mode)**

- R4. In plan mode, built-in `edit` and `write` tools are disabled while other active tools remain available.
- R5. In plan mode, bash is restricted to the example's read-only allowlist; non-allowlisted commands are blocked with a reason naming `/plan` as the exit.

**Done-menu and handoff**

- R6. When plan mode ends with an extracted numbered plan, a select menu presents six options: Execute inline, Subagents via ce-plan → ce-work, Subagents direct dispatch, Write plan with ce-plan, Refine plan, Stay in plan mode.
- R7. "Execute inline" restores full tools and runs steps against `[DONE:n]` tracking, as the shipped example does.
- R8. "Subagents via ce-plan → ce-work" hands the extracted plan to `/skill:ce-plan` (persisting `docs/plans/`) and then `/skill:ce-work` for subagent execution.
- R9. "Subagents direct dispatch" exits plan mode (restoring tools) and dispatches steps to the `subagent` tool without writing a plan doc.
- R10. "Write plan with ce-plan" hands the plan to `/skill:ce-plan` and stops; no auto-execute.
- R11. "Refine plan" opens the editor and re-feeds the refinement as a follow-up, as the shipped example does.
- R12. "Stay in plan mode" leaves mode and todos unchanged.

**Recommendation**

- R13. Plan-mode context instructs the agent to end its plan with a `Recommended execution: inline | subagents` line; the extension marks the matching menu option.
- R14. When no recommendation line is present, the menu defaults to marking "Execute inline".

**Status, widget, persistence**

- R15. A `⏸ plan` footer status shows in plan mode; the todo widget shows during inline execution, as the shipped example does.
- R16. Plan-mode state (enabled, todos, executing, saved tool set) survives session resume via `appendEntry`, as the shipped example does.

**Packaging and sync**

- R17. The extension lives at `extensions/plan-mode/{index.ts,utils.ts}` in this repo and is synced to `~/.pi/agent/extensions/plan-mode/` by the pi-elias installer.
- R18. No `keybindings.json` rebind is shipped; the toggle uses `ctrl+alt+p`, which is free by default, so other machines reinstall identically with no extra setup.

### Key Flows

- F1. Enter plan mode
  - **Trigger:** User presses Tab (or runs `/plan`, or launches with `--plan`).
  - **Actors:** User, plan-mode extension.
  - **Steps:** Toggle fires; write tools disabled; bash allowlist enforced; `⏸ plan` status set; planner-context message injected on next agent turn.
  - **Covered by:** R1, R2, R4, R5, R15

- F2. Done-menu after plan extraction
  - **Trigger:** `agent_end` in plan mode with an extracted numbered plan and `todoItems.length > 0`.
  - **Actors:** User, plan-mode extension, `ce-plan` / `ce-work` skills, `subagent` tool.
  - **Steps:** Menu presents six options; recommendation line parsed and shown; user selection routes to the matching R7–R12 path; plan-mode is exited before any execution path that needs full tools.
  - **Covered by:** R6, R7, R8, R9, R10, R11, R12, R13, R14

### Acceptance Examples

- AE1. **Covers R1, R3.** **Given** Tab is still pi's autocomplete key and no `keybindings.json` override is in effect. **When** the user presses Ctrl+Shift+L on an idle editor. **Then** plan mode toggles and `⏸ plan` appears in the footer; pressing Ctrl+Shift+L again exits plan mode.

- AE2. **Covers R4, R5.** **Given** plan mode is enabled. **When** the agent attempts an `edit`/`write` call or a non-allowlisted bash command. **Then** the call is blocked with a reason naming `/plan` as the exit.

- AE3. **Covers R6, R13, R14.** **Given** the agent produced a numbered plan ending in `Recommended execution: subagents`. **When** `agent_end` fires in plan mode. **Then** the six-option menu appears with "Subagents via ce-plan → ce-work" (or the direct-dispatch sibling) marked as recommended. **And when** the agent omitted the line. **Then** "Execute inline" is marked instead.

- AE4. **Covers R8, R9.** **Given** the user picks a subagent path. **When** the selection is "via ce-plan → ce-work". **Then** `/skill:ce-plan` is queued with the extracted plan, then `/skill:ce-work` runs subagent execution. **And when** the selection is "direct dispatch". **Then** plan mode is exited and steps are dispatched to the `subagent` tool with no plan doc written.

### Scope Boundaries

- **Outside v1:** no per-step subagent configuration UI; no multi-session plan state; no change to the example's bash allowlist; no override of read-only enforcement by other extensions.
- **Deferred for later:** a persisted recommendation history to improve the heuristic; a `/plan-status` surface across sessions.

### Sources

- pi shipped example: `examples/extensions/plan-mode/{index.ts,utils.ts,README.md}` inside the installed `@earendil-works/pi-coding-agent` package.
- `docs/keybindings.md` (`tui.input.tab` default, rebinding mechanism) and `docs/extensions.md` (`registerShortcut`, extension-shortcut-first input chain, `setActiveTools`, `sendUserMessage`) in that package.
- Compound-engineering skills `ce-plan` and `ce-work` (invokable as `/skill:ce-plan` / `/skill:ce-work`).