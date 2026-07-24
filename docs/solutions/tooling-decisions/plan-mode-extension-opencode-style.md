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
  - plan-file
  - plan_enter
  - plan_exit
  - sendusermessage
applies_when:
  - "Building a plan-then-execute UX inside the pi coding-agent harness"
  - "Porting opencode's plan agent design (plan file + plan_enter/plan_exit) to pi's single-agent harness"
  - "Gating tool access for read-only exploration phases"
  - "Choosing a free, macOS-safe toggle key without rebinding keybindings.json"
---

## Context

The pi coding-agent harness ships a `plan-mode` reference inside its npm package (`@earendil-works/pi-coding-agent/examples/extensions/plan-mode/`), but pi-elias wanted a faithful port of **opencode's** plan mode (`packages/core/src/plugin/agent.ts` + `packages/opencode/src/tool/plan.ts`): a read-only planning phase where the agent can read everything and write *only* a plan file, two LLM-callable tools that let the model propose entering and exiting plan mode, and a build-mode handoff. The friction was the same as opencode's — pi's normal tools (`edit`, `write`, freeform `bash`) make "just look, don't touch" risky, because an agent mid-plan will happily start editing. Unlike opencode (two pre-configured agents you `Tab` between), pi is single-agent, so the read-only boundary can't be "switch to a different agent with fewer permissions" — it has to be enforced at the tool-call boundary for the same agent. This work produced `extensions/plan-mode/index.ts` and `extensions/plan-mode/utils.ts`, a single toggle (`Ctrl+Shift+L`, also `/plan` and `--plan`), one `tool_call` handler that gates bash/edit/write/subagent, two LLM tools (`plan_enter`, `plan_exit`), and a per-turn plan-mode reminder mirroring opencode's `plan.txt` (short, urgent, CRITICAL/STRICTLY FORBIDDEN tone, subagent mention) — added to the installer's `CUSTOM_EXTENSION_DIRS=(plan-mode)` sync list (install.sh:31, update.sh:12). The previous version of this extension (tool-set removal + todo tracking + a done-menu + `ce-plan` routing) was superseded; this doc was rewritten to match the current mechanism.

## Guidance

How to build an opencode-style plan mode on pi's single-agent harness:

1. **Three entry points for the same toggle.** `registerFlag` for `--plan` (index.ts:54), `registerCommand` for `/plan` (index.ts:95), and `registerShortcut` for the hotkey (index.ts:100). All three route through `togglePlanMode(ctx)` (index.ts:85), which calls `enablePlanMode` or `disablePlanMode`. The `--plan` flag is read on `session_start` to set the initial state.

2. **Read-only enforcement = one `tool_call` handler, NOT tool-set removal.** This is the core adaptation from opencode. opencode gives the plan agent a different permission ruleset (allow `edit` only under `.opencode/plans/*.md`, deny everything else). pi has one agent, so the same effect is produced by a single `tool_call` handler (index.ts:107) that inspects `event.toolName` and blocks writes outside the carve-out:
   ```ts
   pi.on("tool_call", async (event) => {
     if (!planModeEnabled) return;
     if (event.toolName === "bash") {
       const command = event.input.command as string;
       if (!isSafeCommand(command)) {
         return { block: true,
           reason: `Plan mode: command not on the read-only allowlist. ...` };
       }
       return;
     }
     if (event.toolName === "edit" || event.toolName === "write") {
       const target = event.input.path ?? "";
       if (!isPlanFilePath(target)) {
         return { block: true,
           reason: `Plan mode: write blocked. ...` };
       }
     }
     if (event.toolName === "subagent") {
       return { block: true,
         reason: `Plan mode: subagent delegation blocked. ...` };
     }
   });
   ```
   All tools stay "active" (the tool list the model sees is unchanged) — calls are just blocked at the boundary. The `subagent` tool is blocked (mirrors opencode's `task: { general: "deny" }` for the plan agent), so the model cannot delegate work to subagents during plan mode. This is the lazy, root-cause place: one handler every `bash`/`edit`/`write`/`subagent` call routes through, rather than a per-tool interception scheme or a snapshot-filter-restore of the active tool set.

3. **The plan-file carve-out is a pure path predicate, kept in `utils.ts`.** `isPlanFilePath(target)` (utils.ts:25) resolves the target relative to `cwd`, then returns `true` iff it *is* or lives directly under the project plans dir (`<cwd>/.pi/plans/`, utils.ts:10) or the global plans dir (`~/.pi/agent/plans/`, utils.ts:13). The match uses a trailing-sep guard (`abs === dir || abs.startsWith(dir + nodePath.sep)`) so a sibling like `<cwd>/.pi/plans-evil/x` — which `startsWith(".../plans")` would wrongly accept — is rejected. `newPlanFilePath()` (index.ts:72, utils.ts:16) creates the dir and returns `<plans>/plan-<timestamp>-<rand>.md`. Projects over global means a plan is git-trackable and sits next to the work; the global dir is still accepted so a plan written there by an absolute home-relative path isn't wrongly blocked.

4. **bash keeps an allowlist but cannot be removed**, because it's the exploration surface. `isSafeCommand` (utils.ts:122) is a deny+allow gate: a command must match at least one `SAFE_PATTERNS` entry (utils.ts:69 — `^\s*cat\b`, `^\s*rg\b`, read-only `git status|log|diff|show|...`) AND match no `DESTRUCTIVE_PATTERNS` entry (utils.ts:32 — `rm`, `mv`, redirects `>`/`>>`, package managers, mutating `git` verbs, `sudo`, editors). The two lists are regex arrays keyed against the raw command string — extend the arrays, not the handler, to tune. **Known limitation:** the safe patterns match only the command's *prefix*, and the destructive list is a denylist of words, so a safe-prefixed command chained to an unlisted tool slips through (e.g. `ls | sh`, `ls && curl … -o repo/p`, `git branch <name>`, `git remote add …`). A regex allowlist on raw shell is unsound as a hard boundary; opencode's plan agent takes the other fork (no bash gate at all — it restricts `edit` and leaves bash to ask-permission). Closing this here is a design decision with a behavior tradeoff (rejecting all chaining breaks legitimate `ls -la | grep foo`), so it is surfaced rather than silently patched.

5. **Two LLM-callable tools port opencode's `plan_enter` / `plan_exit`.**
   - `plan_enter` (index.ts:184, description at index.ts:33): the model *proposes* switching to plan mode. If already in plan mode it returns the plan-file path; otherwise it asks the user via `ctx.ui.confirm("Plan mode", "Switch to plan mode? ...")` (index.ts:194) and, on approval, calls `enablePlanMode(ctx)`. This mirrors opencode's `plan_enter.txt` tool description and the user-confirmation step.
   - `plan_exit` (index.ts:208, description at index.ts:44): the model signals the plan file is ready. It confirms via `ctx.ui.confirm("Build mode", "Plan at ${plan} is ready. Switch to build mode?")` (index.ts:221); on approval it calls `disablePlanMode(ctx)`, posts a `plan-handoff` message (index.ts:226), then sends a synthetic user message that kicks off execution (index.ts:231):
     ```ts
     pi.sendUserMessage(
       `The plan at ${plan} has been approved. You can edit any file now. Execute the plan.`,
       { deliverAs: "followUp" },
     );
     ```
     This is the direct analogue of opencode's `PlanExitTool` (`tool/plan.ts`), which on approval appends a synthetic user message `"The plan at ${plan} has been approved, you can now edit files. Execute the plan"` and switches the agent to `build`. `deliverAs: "followUp"` queues the message until the current turn finishes; `sendUserMessage` always triggers a turn, so no `triggerTurn` is needed there (it's accepted only by `sendMessage`).

6. **Inject planner context with `before_agent_start` — mirrors opencode's `plan.txt`.** Each turn in plan mode re-injects a `customType: "plan-mode-context"` message (index.ts:153, `display:false`) that mirrors opencode's plan-agent system prompt: short, urgent tone (CRITICAL / STRICTLY FORBIDDEN), names the plan file, mentions subagent blocking, and emphasizes the read-only constraint. Ends with "Your turn should end by asking the user a question or calling plan_exit." To stop stale plan context leaking into normal turns, the `context` event (index.ts:134) filters out `plan-mode-context` and `plan-handoff` messages (index.ts:139) whenever `planModeEnabled` is false.

7. **Persist and resume via `pi.appendEntry`.** `persistState()` (index.ts:64) writes a `customType: "plan-mode"` entry with `{ enabled, planFilePath }`. On `session_start` (index.ts:245) it pops the last such entry and restores `planFilePath`; `planModeEnabled` is set to the `--plan` flag OR'd over the persisted `enabled`, so an explicit `--plan` start wins over a stale persisted `enabled:false` (flag-applied-after-entry is what makes `--plan` survive resume). If still enabled but no path, it mints one via `newPlanFilePath()` and re-persists so the path survives resume (index.ts:255–258).

8. **Self-check for the carve-out and allowlist, guarded so the import never runs it.** `utils.ts` ends with an `import.meta.main`–guarded `demo()` (utils.ts:129) that asserts the plan-file carve-out allows `<cwd>/.pi/plans/plan-abc.md` and a nested path, blocks the sibling-prefix `<cwd>/.pi/plans-evil/x.md`, `<cwd>/src/index.ts`, and `/etc/passwd`, and checks a few `isSafeCommand` cases (`ls`/`git status` allow; `rm -rf`/`git commit`/`npm install` block). Run `bun utils.ts`. The guard means pi's jiti import of `utils.ts` never executes the assertions.

9. **Toggle key: pick a free, macOS-safe binding; don't ship a `keybindings.json` rebind.** The shipped example used Tab, but Tab is pi's autocomplete (`tui.input.tab`) and extension shortcuts fire first and *consume* the key, so stealing Tab would kill autocomplete. The decision ladder landed on `ctrl+shift+l`: free by default, no macOS Option/Meta quirk (unlike `ctrl+alt+p`, which needs "Use Option as Meta"), and `ctrl+p` was reserved (model cycle / path toggle) and too disruptive to rebind. No `keybindings.json` change is shipped — the shortcut is registered in-extension at index.ts:100, leaving autocomplete untouched.

## Why This Matters

- **Enforcing read-only at the `tool_call` boundary is what makes a single-agent harness safe for planning.** opencode expresses the boundary as a second agent's permission ruleset; pi has one agent, so the same guarantee lives in one handler that every `bash`/`edit`/`write`/`subagent` call routes through. Even a confused agent can't `rm`, `git commit`, install packages, open an editor, delegate to subagents, or write `src/foo.ts` — only the plan file. One guard in the shared function, not one per caller.
- **The plan-file carve-out is a tiny pure predicate (`isPlanFilePath`), so it's checkable without the pi runtime.** Because the boundary is "this path lives under a plans dir," the whole rule is `nodePath.resolve` + a trailing-sep `startsWith`/`===` check per dir (utils.ts:25). That made the runnable self-check (utils.ts:129) worth writing — it fails loudly if the writable surface ever widens by accident (the sibling-prefix assert is the case that would have caught just such a widening).
- **`sendUserMessage(..., {deliverAs:"followUp"})` is the build-mode handoff with no custom API.** `plan_exit` doesn't reach into an agent-switch API — it asks the user, clears plan mode, and drips a synthetic user message, exactly like opencode's `PlanExitTool`. The model sees "execute the plan" as a normal follow-up turn with full tools restored.
- **The keybinding decision avoided collateral damage.** Stealing Tab would have silently broken autocomplete; the chosen `ctrl+shift+l` keeps pi defaults intact and needs no `keybindings.json` migration, so the extension is portable across machines that sync via `CUSTOM_EXTENSION_DIRS`.

## When to Apply

- When porting opencode's plan-agent design to a single-agent harness: enforce the read-only boundary at the shared `tool_call` boundary, not by swapping agents.
- When a tool must stay available but constrained (bash in a read-only phase): gate it in a `tool_call` handler with a deny+allow allowlist, rather than removing the tool.
- When you need a single writable exception to a read-only mode: express it as a pure path predicate (`isPlanFilePath`) and assert it with a guarded self-check, not by enumerating allowed calls in the handler.
- When you need to block subagent delegation during a read-only phase: gate `subagent` in the same `tool_call` handler (mirrors opencode's `task: { general: "deny" }` for the plan agent).
- When designing a plan-mode system prompt: prefer opencode's short, urgent tone (CRITICAL/STRICTLY FORBIDDEN) over a longer phased-workflow tutorial — it enforces the constraint more clearly.
- When an extension should hand control back to the user/agent at a phase boundary: use `ctx.ui.confirm` to gate the switch and `pi.sendUserMessage(text, {deliverAs:"followUp"})` to kick off the next phase — `triggerTurn` is for `sendMessage`, not `sendUserMessage`.
- When choosing a toggle shortcut: check `tui.input.*` defaults and what `ctrl+<key>` is already taken *before* binding; prefer a free default-key over shipping a `keybindings.json` rebind.

## Examples

**Toggle via shortcut (index.ts:100–103):**
```ts
pi.registerShortcut("ctrl+shift+l", {
  description: "Toggle plan mode",
  handler: async (ctx) => togglePlanMode(ctx),
});
```

**Read-only boundary in one `tool_call` handler (index.ts):**
```ts
pi.on("tool_call", async (event) => {
  if (!planModeEnabled) return;
  if (event.toolName === "bash") {
    if (!isSafeCommand(event.input.command as string)) {
      return { block: true, reason: `Plan mode: command not on the read-only allowlist. ...` };
    }
    return;
  }
  if (event.toolName === "edit" || event.toolName === "write") {
    const target = event.input.path ?? "";
    if (!isPlanFilePath(target)) {
      return { block: true, reason: `Plan mode: write blocked. Only the plan file is editable (...). ...` };
    }
  }
  if (event.toolName === "subagent") {
    return { block: true, reason: `Plan mode: subagent delegation blocked. ...` };
  }
});
```

**Plan-file carve-out as a pure predicate (utils.ts:25):**
```ts
export function isPlanFilePath(target: string): boolean {
  const abs = nodePath.isAbsolute(target) ? target : nodePath.resolve(process.cwd(), target);
  const within = (dir: string): boolean => abs === dir || abs.startsWith(dir + nodePath.sep);
  return within(projectPlansDir()) || within(globalPlansDir());
}
```

**`plan_exit` handoff to build mode (index.ts:221–233):**
```ts
const ok = await ctx.ui.confirm("Build mode", `Plan at ${plan} is ready. Switch to build mode and start implementing?`);
if (!ok) return { content: [{ type: "text", text: "Staying in plan mode. Keep refining the plan." }], details: {} };
disablePlanMode(ctx);
pi.sendMessage({ customType: "plan-handoff", content: `**Plan approved** — ${plan}`, display: true }, { triggerTurn: false });
pi.sendUserMessage(`The plan at ${plan} has been approved. You can edit any file now. Execute the plan.`, { deliverAs: "followUp" });
```

**Guarded self-check (utils.ts:129):**
```ts
if ((import.meta as unknown as { main?: boolean }).main) {
  const eq = (a: unknown, b: unknown, msg: string): void => { if (a !== b) { console.error(`FAIL: ${msg}`); process.exit(1); } };
  eq(isPlanFilePath(`${cwd}/.pi/plans/plan-abc.md`), true, "project plan file allowed");
  eq(isPlanFilePath(`${cwd}/.pi/plans-evil/x.md`), false, "sibling-prefix dir blocked");
  eq(isPlanFilePath(`${cwd}/src/index.ts`), false, "src file blocked");
  eq(isSafeCommand("rm -rf /"), false, "rm blocked");
  console.log("plan-mode utils ok");
}
```