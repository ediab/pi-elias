/**
 * Plan Mode Extension (opencode-style)
 *
 * Read-only exploration mode for safe code analysis, toggled with Tab.
 * Adapted from pi's shipped examples/extensions/plan-mode.
 *
 * Features:
 * - Ctrl+Shift+L (or /plan, or --plan flag) to toggle read-only plan mode
 * - Built-in edit/write tools disabled; bash restricted to a read-only allowlist
 * - Extracts numbered plan steps from "Plan:" sections
 * - Agent signs a "Recommended execution: inline | subagents" line
 * - Done-menu: inline execute, subagents via ce-plan→ce-work, subagents direct,
 *   write plan with ce-plan, refine, stay
 * - [DONE:n] markers track inline-execution completion; progress widget
 *
 * Tab stays bound to autocomplete (pi default). The toggle uses Ctrl+Shift+L, which
 * is free by default and needs no keybindings change.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	buildPlanPayload,
	extractExecutionRecommendation,
	extractTodoItems,
	isSafeCommand,
	markCompletedSteps,
	type TodoItem,
} from "./utils.ts";

// Only these built-ins are disabled in plan mode; every other active tool stays.
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);

interface PlanModeState {
	enabled: boolean;
	todos?: TodoItem[];
	executing?: boolean;
	toolsBeforePlanMode?: string[];
}

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let toolsBeforePlanMode: string[] | undefined;
	let recommendation: "inline" | "subagents" | null = null;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget showing todo list
		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
					);
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function enablePlanModeTools(): void {
		if (toolsBeforePlanMode === undefined) {
			toolsBeforePlanMode = pi.getActiveTools();
		}
		pi.setActiveTools(toolsBeforePlanMode.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)));
	}

	function restoreNormalModeTools(): void {
		pi.setActiveTools(toolsBeforePlanMode ?? pi.getActiveTools());
		toolsBeforePlanMode = undefined;
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			toolsBeforePlanMode,
		});
	}

	function exitPlanMode(ctx: ExtensionContext): void {
		planModeEnabled = false;
		executionMode = false;
		todoItems = [];
		recommendation = null;
		restoreNormalModeTools();
		updateStatus(ctx);
		persistState();
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		if (planModeEnabled || executionMode) {
			// Leaving plan/execution entirely
			exitPlanMode(ctx);
			ctx.ui.notify("Plan mode disabled. Full access restored.");
			return;
		}
		planModeEnabled = true;
		executionMode = false;
		todoItems = [];
		recommendation = null;
		enablePlanModeTools();
		ctx.ui.notify("Plan mode enabled. Built-in write tools disabled.");
		updateStatus(ctx);
		persistState();
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerShortcut("ctrl+shift+l", {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Block destructive bash commands in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan or Tab to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled || executionMode) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (
					msg.customType === "plan-mode-context" ||
					msg.customType === "plan-execution-context" ||
					msg.customType === "plan-mode-execute"
				) {
					return false;
				}
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- Built-in edit and write tools are disabled
- Other currently active tools remain available
- Bash is restricted to an allowlist of read-only commands

Explore the codebase, ask clarifying questions, and use web research as needed.
Do NOT attempt to make changes - just describe what you would do.

End your response with a numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Then sign a single recommendation line (exactly this format):

Recommended execution: inline | subagents

Use "subagents" when steps touch independent subsystems or can run in parallel;
use "inline" for a tight, sequential change in one area.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
					display: false,
				},
			};
		}
	});

	// Track progress after each turn during inline execution
	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	// Done-menu + execution routing
	pi.on("agent_end", async (event, ctx) => {
		// Inline execution completion check
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				recommendation = null;
				updateStatus(ctx);
				persistState();
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos + recommendation from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const text = getTextContent(lastAssistant);
			const extracted = extractTodoItems(text);
			if (extracted.length > 0) todoItems = extracted;
			recommendation = extractExecutionRecommendation(text);
		}

		if (todoItems.length === 0) return;
		persistState();

		const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
		const planTodoListMessage = {
			customType: "plan-todo-list",
			content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
			display: true,
		};

		// Build menu options, ★-marking the recommended one
		const inlineLabel = "Execute inline";
		const cePlanSubLabel = "Subagents via ce-plan → ce-work";
		const directSubLabel = "Subagents direct dispatch";
		const writeCePlanLabel = "Write plan with ce-plan";
		const refineLabel = "Refine the plan";
		const stayLabel = "Stay in plan mode";

		// Default to recommending inline when the agent signed no line.
		const recInline = recommendation === "inline" || recommendation === null;
		const star = (label: string) => `${label}  ★`;
		const options = [
			recInline ? star(inlineLabel) : inlineLabel,
			recommendation === "subagents" ? star(cePlanSubLabel) : cePlanSubLabel,
			directSubLabel,
			writeCePlanLabel,
			refineLabel,
			stayLabel,
		];

		const choice = await ctx.ui.select("Plan mode - what next?", options);

		if (!choice) return;

		const payload = buildPlanPayload(todoItems);

		if (choice.startsWith(inlineLabel)) {
			// Inline execution: exit plan mode, keep todos, enter execution mode
			planModeEnabled = false;
			executionMode = true;
			restoreNormalModeTools();
			updateStatus(ctx);
			persistState();

			const firstTodoItem = todoItems[0];
			const remainingList = todoItems.map((t) => `${t.step}. ${t.text}`).join("\n");
			const execMessage = `Execute the plan inline (single session, full tool access).

Remaining steps:
${remainingList}

Start with: ${firstTodoItem?.text ?? "step 1"}.
After completing a step, include a [DONE:n] tag in your response.`;
			pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
			pi.sendMessage(
				{ customType: "plan-mode-execute", content: execMessage, display: true },
				{ triggerTurn: true, deliverAs: "followUp" },
			);
			return;
		}

		if (choice.startsWith(cePlanSubLabel)) {
			// Persist + enrich via ce-plan, then execute via ce-work (queued followUp)
			exitPlanMode(ctx);
			pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
			pi.sendUserMessage(`/skill:ce-plan ${payload}`, { triggerTurn: true });
			pi.sendUserMessage("/skill:ce-work", { deliverAs: "followUp" });
			return;
		}

		if (choice.startsWith(directSubLabel)) {
			// Dispatch steps straight to the subagent tool, no plan doc
			exitPlanMode(ctx);
			pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
			pi.sendUserMessage(
				`${payload}\n\nDispatch the steps above to the \`subagent\` tool. Run independent steps in parallel where safe; keep one agent per coherent unit of work. Do not write a plan doc — execute directly.`,
				{ triggerTurn: true },
			);
			return;
		}

		if (choice.startsWith(writeCePlanLabel)) {
			// ce-plan enriches into docs/plans, then stop (no auto-execute)
			exitPlanMode(ctx);
			pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
			pi.sendUserMessage(`/skill:ce-plan ${payload}`, { triggerTurn: true });
			return;
		}

		if (choice.startsWith(refineLabel)) {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
			return;
		}

		// "Stay in plan mode": no-op
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();

		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: PlanModeState } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
		}

		// On resume: re-scan messages to rebuild completion state
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		if (planModeEnabled) {
			enablePlanModeTools();
		}
		updateStatus(ctx);
	});
}