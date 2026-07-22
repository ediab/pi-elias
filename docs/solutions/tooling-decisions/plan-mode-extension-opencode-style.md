---
module: pi-elias
date: 2026-07-22
problem_type: tooling_decision
component: tooling
severity: low
tags:
  - pi-extension
  - plan-mode
  - read-only
  - keybinding
  - ce-plan
  - sendusermessage
applies_when:
  - "Building a plan-then-execute UX inside the pi coding-agent harness"
  - "Adapting a pi shipped example extension into a harness-specific extension"
  - "Gating tool access for read-only exploration phases"
  - "Routing a plan to ce-plan/ce-work from an extension menu"
  - "Choosing a free, macOS-safe toggle key without rebinding keybindings.json"
---

## Context

The pi coding-agent harness ships a `plan-mode` reference inside its npm package (`@earendil-works/pi-coding-agent/examples/extensions/plan-mode/`), but pi-elias wanted a real, opencode-style **plan mode**: a read-only exploration phase where the agent can grok a codebase and produce a numbered plan *without* being able to mutate anything, followed by a menu that turns the plan into an executable decision (run inline, fan out to subagents, or write a plan doc). The friction was that pi's normal tools (`edit`, `write`, freeform `bash`) make "just look, don't touch" risky — an agent mid-plan will happily start editing. There was also no first-class bridge from a *plan* the agent drafted to the *execution* skills (`ce-plan`, `ce-work`) already present in the harness. This work produced `extensions/plan-mode/index.ts` and `extensions/plan-mode/utils.ts`, a single toggle (`Ctrl+Shift+L`, also `/plan` and `--plan`), a tool-gating layer, a done-menu, and a `pi.sendUserMessage('/skill:ce-...')` handoff — committed as `8e10061` and added to the installer's `CUSTOM_EXTENSION_DIRS=(plan-mode)` sync list (install.sh:31, update.sh:12).

## Guidance

How to build a plan-mode-style extension on pi, adapted from the shipped example:

1. **Three entry points for the same toggle.** Use `registerFlag` for `--plan` (index.ts:62), `registerCommand` for `/plan` (index.ts:143), and `registerShortcut` for the hotkey (index.ts:160). All three call the same `togglePlanMode(ctx)` so behavior is identical regardless of how the user enters plan mode. The `--plan` flag is read on `session_start` (and on resume) to set the initial state.

2. **Read-only enforcement = tool *removal* + a bash allowlist, two separate mechanisms.**
   - Disabling the built-in mutators is done by *filtering them out of the active tool set*, not by intercepting each call. `PLAN_MODE_DISABLED_TOOLS = new Set(["edit", "write"])` (index.ts:33) and `enablePlanModeTools()` snapshots `pi.getActiveTools()` first (so it can restore them), then calls `pi.setActiveTools(tools.filter(n => !PLAN_MODE_DISABLED_TOOLS.has(n)))` (index.ts:99). Only `edit` and `write` are dropped — every other active tool stays. `restoreNormalModeTools()` re-applies the snapshot (index.ts:103).
   - `bash` can't be removed (it's the exploration surface), so it's gated via the `tool_call` event. The handler returns `{ block: true, reason }` for anything not allowlisted (index.ts:166–174):
     ```ts
     pi.on("tool_call", async (event) => {
       if (!planModeEnabled || event.toolName !== "bash") return;
       const command = event.input.command as string;
       if (!isSafeCommand(command)) {
         return { block: true,
           reason: `Plan mode: command blocked (not allowlisted). ...\nCommand: ${command}` };
       }
     });
     ```
   - `isSafeCommand` (utils.ts:98–101) is a deny+allow gate: a command must match at least one `SAFE_PATTERNS` entry AND match no `DESTRUCTIVE_PATTERNS` entry (`return !isDestructive && isSafe`). `SAFE_PATTERNS` (utils.ts:45) anchors read-only commands (`^\s*cat\b`, `^\s*rg\b`, read-only `git status|log|diff|show|...`); `DESTRUCTIVE_PATTERNS` (utils.ts:8) blocks `rm`, `mv`, redirects (`>`, `>>`), package managers, mutating `git` verbs, `sudo`, editors, etc. Both lists are regex arrays keyed against the raw command string — extend the arrays, not the handler, to tune.

3. **Inject planner context with `before_agent_start`.** Each turn in plan mode re-injects a `customType: "plan-mode-context"` message (index.ts:209, display:false) instructing the agent it's read-only, the restrictions, and the required output contract: a numbered `Plan:` block plus a single `Recommended execution: inline | subagents` signature line. To stop stale plan context leaking into normal turns, the `context` event (index.ts:196–207) filters out messages with those `customType`s (and the `[PLAN MODE ACTIVE]` user note) whenever neither `planModeEnabled` nor `executionMode` is active.

4. **Parse the plan from the agent's last message at `agent_end`.** `extractTodoItems` (utils.ts:130) finds the `Plan:` header, matches numbered lines `^\s*(\d+)[.)]\s+...`, and runs them through `cleanStepText` (strip bold/code, drop leading imperative verbs, cap at 50 chars). `extractExecutionRecommendation` (utils.ts:175–180) regex-matches `Recommended execution:\s*(inline|subagents?)` and normalizes to `"inline" | "subagents" | null`. An *absent* line is treated as a default of `inline` (see index.ts:320–321: `recInline = recommendation === "inline" || recommendation === null`).

5. **Present a done-menu with `ctx.ui.select`, star-marking the recommendation.** At `agent_end` (index.ts:275), if a plan was extracted, build six labels and ★-prefix the recommended one, then `const choice = await ctx.ui.select("Plan mode - what next?", options)` (index.ts:334). The six options: Execute inline / Subagents via ce-plan→ce-work / Subagents direct dispatch / Write plan with ce-plan / Refine / Stay (index.ts:314–326).

6. **Route to ce-plan/ce-work via `pi.sendUserMessage('/skill:...', { triggerTurn:true })`.** This is the load-bearing bridge — no custom API, just the same `/skill:` invocation a user would type. For "Subagents via ce-plan → ce-work" (index.ts:366–371):
   ```ts
   exitPlanMode(ctx);
   pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
   pi.sendUserMessage(`/skill:ce-plan ${payload}`, { triggerTurn: true });
   pi.sendUserMessage("/skill:ce-work", { deliverAs: "followUp" });
   ```
   - `triggerTurn: true` fires the queued user message as a fresh agent turn; `deliverAs: "followUp"` queues it rather than posting immediately, so `ce-plan` runs first and `ce-work` waits behind it.
   - `payload` comes from `buildPlanPayload(todoItems)` (utils.ts:185–189): a compact `"Execute this plan:\n\n1. ...\n2. ..."`.
   - "Write plan with ce-plan" sends only the `ce-plan` followUp (index.ts:388–389) — writes the plan doc, no auto-execute.
   - "Subagents direct dispatch" sends the payload as a plain user message telling the agent to call the `subagent` tool directly, with no plan doc (index.ts:375–382).

7. **Inline execution restores tools and tracks `[DONE:n]`.** Choosing "Execute inline" (index.ts:341–363) flips `executionMode=true`, calls `restoreNormalModeTools()`, and injects a `plan-mode-execute` followUp (`{ triggerTurn: true, deliverAs: "followUp" }`) telling the agent to emit `[DONE:n]` per step. `turn_end` (index.ts:263) runs `markCompletedSteps(text, todoItems)` (utils.ts:162), which finds `[DONE:1]`-style tags via `extractDoneSteps` (utils.ts:155) and sets `item.completed=true`. `updateStatus` (index.ts:71) renders a `📋 completed/total` footer and a todo widget (☑/☐). When all are done, `agent_end` posts a "Plan Complete" message and resets (index.ts:278–291).

8. **Persist and resume via `pi.appendEntry`.** `persistState()` (index.ts:117) writes a `customType: "plan-mode"` entry with `{ enabled, todos, executing, toolsBeforePlanMode }`. On `session_start` (index.ts:408) it pops the last such entry, restores the flags, and on resume re-scans assistant messages *after* the last `plan-mode-execute` entry to rebuild `[DONE:n]` completion state (index.ts:430–453), then re-applies tool gating if still in plan mode.

9. **Toggle key: pick a free, macOS-safe binding; don't ship a `keybindings.json` rebind.** The shipped example used Tab, but Tab is pi's autocomplete (`tui.input.tab`) and extension shortcuts fire first and *consume* the key, so stealing Tab would kill autocomplete. The decision ladder landed on `ctrl+shift+l`: free by default, no macOS Option/Meta quirk (unlike `ctrl+alt+p`, which needs "Use Option as Meta"), and `ctrl+p` was reserved (model cycle / path toggle) and too disruptive to rebind. No `keybindings.json` change is shipped — the shortcut is registered in-extension at index.ts:160, leaving autocomplete untouched.

## Why This Matters

- **Read-only enforcement prevents accidental edits during planning.** A plan phase is only meaningful if the agent *can't* act. Disabling `edit`/`write` by tool removal and gating `bash` through a deny+allow regex list (utils.ts:98) means even a confused agent can't `rm`, `git commit`, install packages, or open an editor while it's supposed to only be reading. The guard lives in one `tool_call` handler all bash calls route through — the lazy, root-cause place.
- **A done-menu turns a plan into executable routing.** Instead of the plan being dead text, `agent_end` extracts it and offers six concrete next actions, with the agent's own signed recommendation star-marked and a sensible default (`inline` when no signature). The user picks once and the extension does the rest.
- **`sendUserMessage('/skill:ce-...')` bridges planning and execution without a custom API.** Reusing the same `/skill:` commands a user types, queued as `followUp`s with `triggerTurn:true`, means the extension doesn't need to know ce-plan/ce-work's internals — it just hands them a payload. Adding a new execution path is one more `sendUserMessage` branch, not a new integration.
- **The keybinding decision avoided collateral damage.** Stealing Tab would have silently broken autocomplete; the chosen `ctrl+shift+l` keeps pi defaults intact and needs no `keybindings.json` migration, so the extension is portable across machines that sync via `CUSTOM_EXTENSION_DIRS`.

## When to Apply

- When you want a plan-then-execute UX inside pi, or any "explore read-only, then optionally act" flow.
- When adapting a pi shipped example (the `examples/extensions/...` directory inside the pi npm package) into a harness-specific extension — the example gives the skeleton, but gating, handoff, and keybinding choices need to be made against *this* harness's defaults and installed skills.
- When you need to gate a subset of tools for a phase: follow the snapshot-filter-restore pattern rather than per-call interception, except for tools (like bash) that must remain available but constrained.
- When you want to invoke another extension/skill from code: prefer `pi.sendUserMessage('/skill:name <args>', { triggerTurn:true })` over building a special internal API.
- When choosing a toggle shortcut: check `tui.input.*` defaults and what `ctrl+<key>` is already taken *before* binding; prefer a free default-key over shipping a `keybindings.json` rebind.

## Examples

**Toggle via shortcut (index.ts:160–163):**
```ts
pi.registerShortcut("ctrl+shift+l", {
  description: "Toggle plan mode",
  handler: async (ctx) => togglePlanMode(ctx),
});
```

**Disabling the mutators by tool-set filtering (index.ts:33, 95–100):**
```ts
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
// ...
function enablePlanModeTools(): void {
  if (toolsBeforePlanMode === undefined) toolsBeforePlanMode = pi.getActiveTools();
  pi.setActiveTools(toolsBeforePlanMode.filter((n) => !PLAN_MODE_DISABLED_TOOLS.has(n)));
}
```

**Bash allowlist gate in the `tool_call` handler (index.ts:166–174, utils.ts:98–101):**
```ts
pi.on("tool_call", async (event) => {
  if (!planModeEnabled || event.toolName !== "bash") return;
  if (!isSafeCommand(event.input.command as string)) {
    return { block: true,
      reason: `Plan mode: command blocked (not allowlisted).\nCommand: ${command}` };
  }
});
// utils.ts
export function isSafeCommand(command: string): boolean {
  const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
  const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
  return !isDestructive && isSafe;
}
```

**Done-menu select + recommend-star (index.ts:314–334):**
```ts
const recInline = recommendation === "inline" || recommendation === null; // absent => inline
const star = (label: string) => `${label}  ★`;
const options = [
  recInline ? star(inlineLabel) : inlineLabel,
  recommendation === "subagents" ? star(cePlanSubLabel) : cePlanSubLabel,
  directSubLabel, writeCePlanLabel, refineLabel, stayLabel,
];
const choice = await ctx.ui.select("Plan mode - what next?", options);
const payload = buildPlanPayload(todoItems);
```

**Routing to ce-plan→ce-work as `/skill:` follow-ups (index.ts:366–371):**
```ts
pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
pi.sendUserMessage(`/skill:ce-plan ${payload}`, { triggerTurn: true });
pi.sendUserMessage("/skill:ce-work", { deliverAs: "followUp" });
```