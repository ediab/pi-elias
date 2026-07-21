---
title: "Keep npm:pi-subagents for ce-compound-engineering (not @tintinweb/pi-subagents)"
date: 2026-07-21
category: tooling-decisions
module: pi-subagents dependency / pi-elias installer
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Choosing or swapping the subagent-dispatch extension in a pi harness that runs ce-compound-engineering skills"
  - "Seeing /ce-status report pi-subagents as not installed despite an alternate subagent package being present"
  - "Deciding whether @tintinweb/pi-subagents can replace npm:pi-subagents in the pi-elias install.sh PACKAGES list"
tags: [pi-subagents, ce-compound-engineering, tintinweb, dependency, tooling]
---

# Keep `npm:pi-subagents` for ce-compound-engineering (not `@tintinweb/pi-subagents`)

## Context

The `pi-compound-engineering` package (ce-engineering) hard-depends on Nicobailon's `npm:pi-subagents` (v0.35.1) as a peer tool provider. Its skills (`ce-compound`, `ce-code-review`, `ce-plan`, `ce-compound-refresh`, and others) drive parallel/chain orchestration by instructing the model to invoke a pi tool whose API surface is Nicobailon-specific: `{agent, task, action, chainName, chain, parallel, tasks, ...}`.

A *different* package, `@tintinweb/pi-subagents` (v0.14.2, by a different author), exists with a confusingly similar name. The friction that prompted this guidance: an installer `PACKAGES` list could naïvely swap one for the other on the assumption that they are interchangeable, and once only tintinweb's package is installed every CE skill that dispatches subagents silently degrades to inline execution.

The fix applied in this repo (`pi-elias`): keep `npm:pi-subagents` in `install.sh`'s `PACKAGES` list; do **not** replace it with `npm:@tintinweb/pi-subagents`. The two packages may coexist (no tool-name or slash-command collision), but tintinweb cannot substitute for Nicobailon's here.

## Guidance

Do not treat `npm:pi-subagents` and `npm:@tintinweb/pi-subagents` as interchangeable. The dependency is not by name, package, or theme — it is by **registered tool name + parameter shape**, both of which are hard-coded in ce-engineering's source.

`<pi-packages>` below denotes the pi npm package install root (the `node_modules` directory pi installs packages into — global by default, project-local with `pi install -l`). These are files inside the *installed packages*, not files in this repo.

ce-engineering detects its subagent provider with an exact string match. In `<pi-packages>/pi-compound-engineering/src/dependency-check.ts`:

```ts
// <pi-packages>/pi-compound-engineering/src/dependency-check.ts:28
const subagentTool = tools.find((t) => t.name === "subagent");
```

and the corresponding warning fired by `/ce-status` and the per-session guard is:

```ts
// <pi-packages>/pi-compound-engineering/src/dependency-check.ts:62
const SUBAGENT_WARNING =
	"pi-compound-engineering: pi-subagents is not installed. Skills that dispatch subagents (ce-compound, ce-code-review, ce-plan, ce-compound-refresh) will fall back to inline execution. Install with: pi install npm:pi-subagents";
```

Nicobailon's package registers exactly that tool name:

```ts
// <pi-packages>/pi-subagents/src/extension/index.ts:397
name: "subagent",
```

`tintinweb`'s package registers a tool with a different name (`Agent`, not `subagent`) and a different parameter schema (`{subagent_type, prompt, run_in_background, model, thinking, max_turns, isolated, inherit_context, ...}`) plus separate `get_subagent_result` / `steer_subagent` tools and a `/agents` slash command — versus Nicobailon's `/subagents`, `/run`, `/chain`, `/parallel`.

> **Grounding note (attribution, not verified):** the tintinweb API-shape claim above reflects the package's documented v0.14.2 surface as described in the originating session. It could **not** be re-verified against the installed tree at write time — `@tintinweb/pi-subagents` was uninstalled and its source path `<pi-packages>/@tintinweb/pi-subagents/src/index.ts` is **absent**. Treat the tintinweb API-shape claim as session-reported, not confirmed against a live checkout. The Nicobailon side (`<pi-packages>/pi-compound-engineering/src/dependency-check.ts:28`, `<pi-packages>/pi-subagents/src/extension/index.ts:397`) **is** verified verbatim above.

Practical rule:

- Keep `npm:pi-subagents` in `install.sh`'s `PACKAGES`. The repo does exactly this: `install.sh:10` — `npm:pi-subagents` (`install.sh:10` is repo-relative; every other path above points into installed packages).
- It is safe to *also* install `npm:@tintinweb/pi-subagents` if you want its features; the tool names (`subagent` vs `Agent`) and slash commands (`/subagents` vs `/agents`) do not collide.
- Custom `.pi/agents/*.md` agent-definition files do **not** bridge the gap: an agent definition only gives the tool an agent to spawn. Without a tool literally named `subagent` registered, the model has nothing to call, and ce-engineering's skill prompts (which say `subagent({agent, task, action, chain, parallel, tasks, ...})`) resolve to no tool.

## Why This Matters

This is a silent-degradation failure, not an error. With only tintinweb installed:

- `tools.find((t) => t.name === "subagent")` returns `undefined`.
- `/ce-status` reports pi-subagents as not installed.
- `maybeWarnAboutDependencies` fires `SUBAGENT_WARNING` once per session (`<pi-packages>/pi-compound-engineering/src/dependency-check.ts:62`).
- Every CE skill that dispatches subagents falls back to **inline execution** — the orchestrator does the work itself instead of fanning out. No exception is raised; throughput and review-fanout simply collapse to a single agent, which defeats the entire point of `ce-compound` / `ce-code-review`.

The cost of the naïve swap is exactly the loss of parallelism, and the failure mode is "looks like it works, slower, non-parallel." That is the worst kind of regression to debug: nothing throws, results are just worse.

The exact-match detection (`t.name === "subagent"`, no fuzzy/alias logic) is intentional upstream design — it pins a single, stable contract. That pin is the reason a same-niche but different-API package cannot stand in.

## When to Apply

- When editing a pi installer's `PACKAGES` list and considering whether `npm:pi-subagents` can be dropped or swapped for a similarly-named package.
- When `/ce-status` reports pi-subagents missing despite some subagent package being installed — verify the *registered tool name*, not the package name.
- When auditing `dependency-check.ts` or proposing a more flexible (alias-based) detection scheme: the exact match is the contract; relaxing it would require ce-engineering's skill prompts and the `SubagentParams` schema to match the replacement tool's API as well.
- When a new package calls itself `pi-subagents` (or similar): check `pi.getAllTools().find((t) => t.name === "subagent")`, not the package id.

## Examples

**Wrong (naïve installer swap):**
```bash
PACKAGES=(
  npm:@tintinweb/pi-subagents   # different author, tool name is "Agent", no action/chain/parallel
  npm:pi-compound-engineering
)
```
Result: `/ce-status` shows pi-subagents not installed; ce-compound runs single-threaded inline.

**Right (keep Nicobailon's, tintinweb optional):**
```bash
PACKAGES=(
  npm:pi-subagents              # dependency-check.ts:28 matches this tool; keep it
  npm:pi-compound-engineering
  # npm:@tintinweb/pi-subagents   # optional add-on; coexists, does not substitute
)
```

**Diagnostic one-liner** to confirm which package owns the `subagent` tool at runtime:
```ts
pi.getAllTools().find((t) => t.name === "subagent")?.sourceInfo
```
If this returns `undefined`, CE subagent dispatch is offline regardless of what package is installed.

## Related

- `<pi-packages>/pi-compound-engineering/src/dependency-check.ts:28` — `tools.find((t) => t.name === "subagent")` exact-match gate.
- `<pi-packages>/pi-compound-engineering/src/dependency-check.ts:62` — `SUBAGENT_WARNING` string naming the affected skills.
- `<pi-packages>/pi-subagents/src/extension/index.ts:397` — `name: "subagent"` registration that satisfies the gate.
- ce-engineering skill `SKILL.md` files reference the `subagent` tool and Nicobailon-specific params (`agent`, `task`, `action`, `chain`, `parallel`, `tasks`).
- `AGENTS.md` "Compound Engineering (Pi compatibility)" block records `pi-subagents` (by nicobailon) as the required package for CE skills.