/**
 * Plan Mode Extension (opencode-style port)
 *
 * A read-only planning mode with a writable plan file and LLM-callable
 * plan_enter / plan_exit tools — adapted from opencode's plan agent
 * (packages/core/src/plugin/agent.ts + tool/plan.ts).
 *
 * Design parity with opencode:
 *   - In plan mode, edit/write are blocked EXCEPT the plan file (the only
 *     writable target), and bash is restricted to a read-only allowlist.
 *   - LLM tool `plan_enter`: the model proposes switching to plan mode; the
 *     user confirms.
 *   - LLM tool `plan_exit`: the model signals the plan file is ready; the user
 *     confirms switching to build mode, which restores full tool access and
 *     sends a synthetic "execute the plan" user message.
 *   - A before_agent_start system reminder names the plan file path and walks
 *     the phased workflow (understand → plan → synthesize → final plan → exit).
 *
 * Toggle: /plan command, Ctrl+Shift+L, or --plan flag. Changing active tools is
 * not needed — the read-only boundary is enforced in the tool_call handler.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { isPlanFilePath, isSafeCommand, newPlanFilePath } from "./utils.ts";

interface PlanModeState {
	enabled: boolean;
	planFilePath?: string;
}

const PLAN_ENTER_DESCRIPTION = `Use this tool to propose switching to plan mode when the user's request would benefit from planning before implementation.

If the user explicitly asks to plan first, ALWAYS call this tool. It asks the user to confirm switching to plan mode.

Call this tool when:
- The request is complex and would benefit from planning first
- You want to research and design before making changes
- The task spans multiple files or significant architectural decisions

Do NOT call this tool for simple, straightforward tasks or when the user wants immediate implementation.`;

const PLAN_EXIT_DESCRIPTION = `Use this tool when you have finished planning and the plan file is ready for implementation.

It asks the user to switch to build mode (full tool access) and start implementing the plan.

Call this tool only after you have written the complete plan to the plan file and resolved open questions with the user. Do not call it if the plan is unfinished or the user wants to keep planning.`;

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let planFilePath: string | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only, write only the plan file)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus("plan-mode", planModeEnabled ? ctx.ui.theme.fg("warning", "⏸ plan") : undefined);
	}

	function persistState(): void {
		pi.appendEntry<PlanModeState>("plan-mode", {
			enabled: planModeEnabled,
			planFilePath,
		});
	}

	function enablePlanMode(ctx: ExtensionContext): void {
		if (!planFilePath) planFilePath = newPlanFilePath();
		planModeEnabled = true;
		updateStatus(ctx);
		persistState();
	}

	function disablePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = false;
		planFilePath = undefined;
		updateStatus(ctx);
		persistState();
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			disablePlanMode(ctx);
			ctx.ui.notify("Plan mode disabled. Full access restored.");
			return;
		}
		enablePlanMode(ctx);
		ctx.ui.notify(`Plan mode enabled. Write the plan to ${planFilePath}.`, "info");
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only; only the plan file is writable)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerShortcut("ctrl+shift+l", {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Enforce the read-only boundary in plan mode: block bash outside the
	// allowlist, and block edit/write unless the target is the plan file.
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled) return;

		if (event.toolName === "bash") {
			const command = (event.input as { command?: string }).command ?? "";
			if (!isSafeCommand(command)) {
				return {
					block: true,
					reason: `Plan mode: command not on the read-only allowlist. Use /plan or Ctrl+Shift+L to leave plan mode first.\nCommand: ${command}`,
				};
			}
			return;
		}

		if (event.toolName === "edit" || event.toolName === "write") {
			const target = (event.input as { path?: string }).path ?? "";
			// ponytail: allow write under the dedicated plans dirs only; everything else blocked.
			if (!isPlanFilePath(target)) {
				return {
					block: true,
					reason: `Plan mode: write blocked. Only the plan file is editable (\`${planFilePath ?? "<cwd>/.pi/plans/plan-*.md"}\`). Use /plan to leave plan mode.`,
				};
			}
		}
	});

	// Filter stale plan-mode context out of LLM history when not in plan mode.
	pi.on("context", async (event) => {
		if (planModeEnabled) return;
		return {
			messages: event.messages.filter((m) => {
				const msg = m as { customType?: string; role?: string; content?: unknown };
				if (msg.customType === "plan-mode-context" || msg.customType === "plan-handoff") return false;
				if (msg.role !== "user") return true;
				const content = msg.content;
				if (typeof content === "string") return !content.includes("[PLAN MODE ACTIVE]");
				if (Array.isArray(content)) {
					return !content.some((c) => c?.type === "text" && typeof c.text === "string" && c.text.includes("[PLAN MODE ACTIVE]"));
				}
				return true;
			}),
		};
	});

	// Per-turn plan-mode system reminder (opencode-style): name the plan file
	// and walk the phased workflow.
	pi.on("before_agent_start", async () => {
		if (!planModeEnabled || !planFilePath) return;
		return {
			message: {
				customType: "plan-mode-context",
				content: `[PLAN MODE ACTIVE]
You are in plan mode. Explore the codebase, research, and design before any change.

Restrictions:
- You may edit or write only files under the plans dir (e.g. ${planFilePath}); all other edits/writes are blocked.
- Your plan file is: ${planFilePath}
- bash is restricted to a read-only command allowlist.

## Plan File Info
Build the plan incrementally by writing to ${planFilePath} (any file under .pi/plans/ is writable; everything else is blocked). Hold your final recommended approach there: comprehensive enough to execute, but concise. Not every alternative considered — just the recommended one.

## Planning Workflow
1. Understand: read code and explore; ask the user clarifying questions up front.
2. Plan: design an approach.
3. Synthesize: confirm trade-offs and open questions with the user.
4. Final plan: write it to ${planFilePath}.
5. Exit: call the plan_exit tool to hand off to build mode for implementation.

Your turn should end only by asking the user a question or calling plan_exit. Do not make changes other than writing the plan file.`,
				display: false,
			},
		};
	});

	// LLM-callable: propose entering plan mode.
	pi.registerTool({
		name: "plan_enter",
		label: "Enter Plan Mode",
		description: PLAN_ENTER_DESCRIPTION,
		promptSnippet: "plan_enter — propose switching to read-only plan mode (asks the user)",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			if (planModeEnabled) {
				return { content: [{ type: "text", text: `Already in plan mode. Plan file: ${planFilePath}` }], details: {} };
			}
			if (!ctx.hasUI) {
				return { content: [{ type: "text", text: "Plan mode requested but there is no UI to confirm. Proceed normally." }], details: {} };
			}
			const ok = await ctx.ui.confirm("Plan mode", "Switch to plan mode? (read-only; only the plan file is writable)");
			if (!ok) return { content: [{ type: "text", text: "User declined. Continue with normal implementation." }], details: {} };
			enablePlanMode(ctx);
			return {
				content: [{ type: "text", text: `Plan mode enabled. Write the plan to ${planFilePath}. Call plan_exit when the plan is ready to implement.` }],
				details: {},
			};
		},
	});

	// LLM-callable: signal the plan is ready; on user approval, hand off to build mode.
	pi.registerTool({
		name: "plan_exit",
		label: "Exit Plan Mode",
		description: PLAN_EXIT_DESCRIPTION,
		promptSnippet: "plan_exit — signal the plan file is ready; ask the user to switch to build mode",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			if (!planModeEnabled) {
				return { content: [{ type: "text", text: "Not in plan mode — nothing to exit." }], details: {} };
			}
			const plan = planFilePath ?? "<plan file>";
			if (!ctx.hasUI) {
				return { content: [{ type: "text", text: "No UI to confirm build-mode switch; staying in plan mode." }], details: {} };
			}
			const ok = await ctx.ui.confirm("Build mode", `Plan at ${plan} is ready. Switch to build mode and start implementing?`);
			if (!ok) return { content: [{ type: "text", text: "Staying in plan mode. Keep refining the plan." }], details: {} };

			disablePlanMode(ctx);
			pi.sendMessage(
				{ customType: "plan-handoff", content: `**Plan approved** — ${plan}`, display: true },
				{ triggerTurn: false },
			);
			// sendUserMessage always triggers a turn; deliverAs followUp queues it
			// until the current turn finishes.
			pi.sendUserMessage(
				`The plan at ${plan} has been approved. You can edit any file now. Execute the plan.`,
				{ deliverAs: "followUp" },
			);
			return {
				content: [{ type: "text", text: "User approved switching to build mode. Wait for the execution instruction." }],
				details: {},
			};
		},
	});

	// Restore persisted state on session start/resume. The --plan flag is applied AFTER the
	// entry restore so an explicit `--plan` start wins over a stale persisted `enabled:false` —
	// otherwise resuming with --plan would silently drop plan mode.
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		const entry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: PlanModeState } | undefined;

		planModeEnabled = (pi.getFlag("plan") === true) || (entry?.data?.enabled ?? false);
		planFilePath = entry?.data?.planFilePath ?? planFilePath;

		if (planModeEnabled && !planFilePath) {
			planFilePath = newPlanFilePath();
			persistState(); // remember the path so a --plan start survives resume
		}
		updateStatus(ctx);
	});
}