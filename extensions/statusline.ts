/**
 * elias-statusline — theme-aware HUD for Pi.
 * Forked from pi-shannon-statusline: matrix rain removed, colors driven by
 * ctx.ui.theme instead of a hardcoded Monokai Pro palette, and a ponytail
 * mode segment added to the model line (read from session entries).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────

interface GitStatus {
	branch: string;
	isDirty: boolean;
	ahead: number;
	behind: number;
	modified: number;
	added: number;
	deleted: number;
	untracked: number;
}

interface AgentRecord {
	status: "running" | "completed";
	startTime: number;
	endTime?: number;
}

interface ToolRecord {
	name: string;
	target: string | null;
	status: "running" | "completed" | "error";
	startTime: number;
	endTime?: number;
}

// ── State ──────────────────────────────────────────────────────────

let sessionStartTime = 0;
let turnIndex = 0;
let agents: AgentRecord[] = [];
let tools: ToolRecord[] = [];
let modelProvider = "";
let modelId = "";
let thinkingLevel = "";
let cwd = "";

// ── Icons (plain glyphs, no emoji — matches shannon's set) ─────────

const I_MODEL = "λ";
const I_PATH = "⌘";
const I_BRANCH = "⎇";
const I_CLOCK = "✦";
const I_CTX = "⊡";
const I_IN = "↑";
const I_CLAUDE = "※";
const I_MCP = "⊕";
const I_SKILL = "★";
const I_EXT = "◈";
const I_RUN = "↻";
const I_PONY = "◇";
const I_THINK = "✶";

// ── Theme helpers ──────────────────────────────────────────────────

type Theme = { fg?: (token: string, text: string) => string } | undefined;

function fg(theme: Theme, token: string, text: string): string {
	// ponytail: fall back to bare text if theme/fg missing (print mode, older pi)
	return theme?.fg ? theme.fg(token, text) : text;
}

function sep(theme: Theme): string {
	return fg(theme, "dim", "│");
}

// level → theme color token (by intensity tier)
const PONY_COLOR: Record<string, string> = {
	lite: "success",
	full: "accent",
	ultra: "error",
};
// ponytail: thinking tiers — higher effort = hotter color, mirroring ctxColor
const THINK_COLOR: Record<string, string> = {
	minimal: "dim",
	low: "success",
	medium: "accent",
	high: "warning",
	xhigh: "error",
	max: "error",
};

// ── Fish-style path shortening (from shannon-statusline) ───────────

function abbreviateSegment(segment: string): string {
	if (segment.length <= 1) return segment;
	const extra = segment.match(/[-.](.)/);
	return extra ? `${segment[0]}${extra[0]}` : segment[0]!;
}

function truncateTailSegment(segment: string, maxLen: number): string {
	if (segment.length <= maxLen) return segment;
	if (maxLen <= 1) return "…";
	const extStart = segment.lastIndexOf(".");
	const hasExt = extStart > 0 && extStart < segment.length - 1;
	if (!hasExt) return `…${segment.slice(-(maxLen - 1))}`;
	const ext = segment.slice(extStart);
	const base = segment.slice(0, extStart);
	const budget = maxLen - ext.length - 1;
	if (budget <= 0) return `…${ext.slice(-(maxLen - 1))}`;
	return `…${base.slice(-budget)}${ext}`;
}

function shortenDisplayPath(fullPath: string, home: string, maxLen: number): string {
	if (!fullPath) return "";
	let display = fullPath;
	if (home && fullPath === home) return "~";
	if (home && fullPath.startsWith(home + "/")) {
		display = "~" + fullPath.slice(home.length);
	}

	const prefix = display.startsWith("~") ? "~" : display.startsWith("/") ? "/" : "";
	const rawParts = display.split("/").filter(Boolean);
	const parts = prefix === "~" ? rawParts.slice(1) : rawParts;
	if (parts.length <= 1) return display;

	const tail = parts.slice(-1);
	const head = parts.slice(0, -1).map(abbreviateSegment);
	let shortened = [...head, ...tail].join("/");
	if (prefix) shortened = prefix + "/" + shortened;

	if (shortened.length <= maxLen) return shortened;

	const ellipsis = prefix + "/…/" + tail.join("/");
	if (ellipsis.length <= maxLen) return ellipsis;

	const budget = Math.max(1, maxLen - (prefix ? prefix.length + 4 : 3));
	return `${prefix ? prefix + "/" : ""}…/${truncateTailSegment(tail[0]!, budget)}`;
}

// ── Context bar (theme-aware: threshold tokens, no rgb gradient) ────

function ctxColor(percent: number): string {
	if (percent >= 85) return "error";
	if (percent >= 70) return "warning";
	return "success";
}

function ctxBar(theme: Theme, percent: number, width: number): string {
	const safeP = Math.min(100, Math.max(0, percent));
	const filled = Math.round((safeP / 100) * width);
	const empty = width - filled;
	return `${fg(theme, ctxColor(safeP), "█".repeat(filled))}${fg(theme, "dim", "░".repeat(empty))}`;
}

// ── Tool whitelist — only Pi-native tools shown ────────────────────

const TOOL_WHITELIST = new Set([
	"read", "write", "edit", "bash",
	"grep", "ls", "find",
]);

// ── Formatters ─────────────────────────────────────────────────────

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return `${n}`;
}

function fmtDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const s = ms / 1000;
	if (s < 60) return `${s.toFixed(0)}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}

// ── Git ────────────────────────────────────────────────────────────

async function getGit(dir: string): Promise<GitStatus | null> {
	if (!dir) return null;
	try {
		const { stdout: branchOut } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			cwd: dir, timeout: 1500, encoding: "utf8",
		});
		const branch = branchOut.trim();
		if (!branch) return null;

		let isDirty = false, modified = 0, added = 0, deleted = 0, untracked = 0;
		try {
			const { stdout: statusOut } = await execFileAsync("git", ["--no-optional-locks", "status", "--porcelain"], {
				cwd: dir, timeout: 1500, encoding: "utf8",
			});
			const lines = statusOut.trim().split("\n").filter(Boolean);
			isDirty = lines.length > 0;
			for (const line of lines) {
				if (line.startsWith("??")) untracked++;
				else if (line[0] === "A") added++;
				else if (line[0] === "D" || line[1] === "D") deleted++;
				else if (line[0] === "M" || line[1] === "M" || line[0] === "R" || line[0] === "C") modified++;
			}
		} catch { /* ignore */ }

		let ahead = 0, behind = 0;
		try {
			const { stdout: revOut } = await execFileAsync("git", ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], {
				cwd: dir, timeout: 1500, encoding: "utf8",
			});
			const parts = revOut.trim().split(/\s+/);
			if (parts.length === 2) { behind = parseInt(parts[0]!, 10) || 0; ahead = parseInt(parts[1]!, 10) || 0; }
		} catch { /* no upstream */ }

		return { branch, isDirty, ahead, behind, modified, added, deleted, untracked };
	} catch { return null; }
}

// ── Config counter ─────────────────────────────────────────────────

function countConfigs(dir: string) {
	let agentsMd = 0, mcps = 0, skills = 0, extensions = 0;
	const home = homedir();
	try {
		if (existsSync(join(dir, "AGENTS.md"))) agentsMd++;
		if (existsSync(join(dir, "CLAUDE.md"))) agentsMd++;

		try {
			const mcpCache = JSON.parse(readFileSync(join(home, ".pi", "agent", "mcp-cache.json"), "utf8"));
			const servers = mcpCache?.servers;
			if (servers && typeof servers === "object") mcps = Object.keys(servers).length;
		} catch { /* ignore */ }

		const skillsDir = join(home, ".pi", "agent", "skills");
		if (existsSync(skillsDir)) {
			skills = readdirSync(skillsDir).filter(f => !f.startsWith(".")).length;
		}

		try {
			const settings = JSON.parse(readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8"));
			const packages: string[] = settings?.packages ?? [];
			extensions = packages.length;
		} catch { /* ignore */ }
	} catch { /* ignore */ }
	return { agentsMd, mcps, skills, extensions };
}

// ── Mode readers (live state from session entries) ─────────────────

function lastCustomEntry(entries: any[], customType: string): any | null {
	if (!Array.isArray(entries)) return null;
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e?.type === "custom" && e?.customType === customType) return e?.data ?? null;
	}
	return null;
}

// ponytail: matches ponytail's getDefaultMode() — env > config file > 'full'.
// Ponytail's pi-extension resolves its mode on session_start but does NOT append
// a session entry unless /ponytail <mode> is run explicitly, so the default must
// be read from the same sources ponytail reads.
const PONY_VALID = new Set(["off", "lite", "full", "ultra", "review"]);

function ponytailDefaultMode(): string {
	const env = process.env.PONYTAIL_DEFAULT_MODE;
	if (env && PONY_VALID.has(env.toLowerCase())) return env.toLowerCase();
	try {
		const cfg = JSON.parse(readFileSync(join(homedir(), ".config", "ponytail", "config.json"), "utf8"));
		const m = String(cfg?.defaultMode ?? "").toLowerCase();
		if (PONY_VALID.has(m)) return m;
	} catch { /* no/invalid config */ }
	return "full";
}

function readPonytailMode(ctx: any): string | null {
	const entries = ctx?.sessionManager?.getEntries?.() ?? ctx?.sessionManager?.getBranch?.() ?? [];
	const data = lastCustomEntry(entries, "ponytail-mode");
	const mode = data?.mode ? String(data.mode) : ponytailDefaultMode();
	return mode && mode !== "off" ? mode : null;
}

// ── Mode segments (icon + dim label + colored level, no emoji) ─────

function ponySegment(theme: Theme, mode: string): string {
	const color = PONY_COLOR[mode] ?? "accent";
	return `${fg(theme, color, I_PONY)} ${fg(theme, "muted", "ponytail")} ${fg(theme, color, mode.toUpperCase())}`;
}

function thinkSegment(theme: Theme, level: string): string {
	const color = THINK_COLOR[level] ?? "accent";
	return `${fg(theme, color, I_THINK)} ${fg(theme, "muted", "thinking")} ${fg(theme, color, level.toUpperCase())}`;
}

// ── HUD renderer ───────────────────────────────────────────────────

async function buildHud(ctx: any): Promise<string[]> {
	const lines: string[] = [];
	const theme: Theme = ctx?.ui?.theme;
	const s = sep(theme);
	const dir = cwd;

	// ── Line 1: Project + Git + Duration ──
	const parts1: string[] = [];
	if (dir) {
		const home = homedir();
		parts1.push(`${fg(theme, "warning", I_PATH)} ${fg(theme, "warning", shortenDisplayPath(dir, home, 30))}`);
	}

	const git = await getGit(dir);
	if (git) {
		const dirty = git.isDirty ? "*" : "";
		let gitStr = `${fg(theme, "accent", I_BRANCH)} ${fg(theme, "accent", `${git.branch}${dirty}`)}`;
		const details: string[] = [];
		if (git.ahead > 0) details.push(fg(theme, "success", `↑${git.ahead}`));
		if (git.behind > 0) details.push(fg(theme, "error", `↓${git.behind}`));
		if (git.modified > 0) details.push(fg(theme, "error", `!${git.modified}`));
		if (git.added > 0) details.push(fg(theme, "success", `+${git.added}`));
		if (git.deleted > 0) details.push(fg(theme, "error", `✘${git.deleted}`));
		if (git.untracked > 0) details.push(fg(theme, "muted", `?${git.untracked}`));
		if (details.length > 0) gitStr += ` ${details.join(" ")}`;
		parts1.push(gitStr);
	}

	if (sessionStartTime > 0) {
		if (turnIndex > 0) parts1.push(`${fg(theme, "accent", "↺ loop")} ${fg(theme, "text", `×${turnIndex}`)}`);
		parts1.push(`${fg(theme, "dim", I_CLOCK)} ${fg(theme, "dim", fmtDuration(Date.now() - sessionStartTime))}`);
	}

	lines.push(parts1.join(` ${s} `));

	// ── Line 2: Model + modes + Context + Tokens ──
	const line2: string[] = [];

	let modelStr: string;
	if (modelProvider && modelId) {
		modelStr = `${fg(theme, "accent", I_MODEL)} ${fg(theme, "muted", modelProvider)}/${fg(theme, "accent", modelId)}`;
	} else if (modelId) {
		modelStr = `${fg(theme, "accent", I_MODEL)} ${fg(theme, "accent", modelId)}`;
	} else if (modelProvider) {
		modelStr = `${fg(theme, "accent", I_MODEL)} ${fg(theme, "accent", modelProvider)}`;
	} else {
		modelStr = `${fg(theme, "accent", I_MODEL)} ${fg(theme, "accent", "pi")}`;
	}
	line2.push(modelStr);

	if (thinkingLevel && thinkingLevel !== "off") line2.push(thinkSegment(theme, thinkingLevel));

	const pony = readPonytailMode(ctx);
	if (pony) line2.push(ponySegment(theme, pony));

	try {
		const usage = ctx.getContextUsage?.();
		if (usage) {
			const pct = usage.percent ?? 0;
			const bar = ctxBar(theme, pct, 10);
			const win = usage.contextWindow ?? 0;
			const winLabel = win >= 1_000_000 ? `${(win / 1_000_000).toFixed(1)}M` : win >= 1000 ? `${Math.round(win / 1000)}k` : "";
			let ctxStr = `${fg(theme, "accent", I_CTX)} ${bar} ${fg(theme, ctxColor(pct), `${pct.toFixed(1)}%`)}`;
			if (winLabel) ctxStr += ` ${fg(theme, "dim", `(${winLabel})`)}`;
			line2.push(ctxStr);

			const totalTokens = usage.tokens ?? 0;
			line2.push(`${fg(theme, "accent", I_IN)} ${fg(theme, "text", fmtTokens(totalTokens))}`);
		}
	} catch { /* context usage unavailable */ }

	lines.push(line2.join(` ${s} `));

	// ── Line 3: Config counts ──
	const configs = countConfigs(dir);
	const cfgParts: string[] = [];
	if (configs.agentsMd > 0) cfgParts.push(`${fg(theme, "accent", I_CLAUDE)} ${fg(theme, "accent", `×${configs.agentsMd}`)} ${fg(theme, "dim", "AGENTS.md")}`);
	if (configs.mcps > 0) cfgParts.push(`${fg(theme, "warning", I_MCP)} ${fg(theme, "warning", `×${configs.mcps}`)} ${fg(theme, "dim", "MCPs")}`);
	if (configs.skills > 0) cfgParts.push(`${fg(theme, "accent", I_SKILL)} ${fg(theme, "accent", `×${configs.skills}`)} ${fg(theme, "dim", "skills")}`);
	if (configs.extensions > 0) cfgParts.push(`${fg(theme, "warning", I_EXT)} ${fg(theme, "warning", `×${configs.extensions}`)} ${fg(theme, "dim", "extensions")}`);
	if (cfgParts.length > 0) lines.push(cfgParts.join(` ${s} `));

	// ── Agent activity ──
	const activeAgents = agents.filter(a => a.status === "running").length;
	const completedAgents = agents.filter(a => a.status === "completed").length;

	// ── Tool counts ──
	const completed = tools.filter(t => t.status === "completed" && TOOL_WHITELIST.has(t.name));
	const toolCounts = new Map<string, number>();
	for (const t of completed) toolCounts.set(t.name, (toolCounts.get(t.name) ?? 0) + 1);

	const toolLineParts: string[] = [];
	for (const name of toolCounts.keys()) {
		const count = toolCounts.get(name) ?? 0;
		if (count > 0) toolLineParts.push(`${fg(theme, "success", "✔")} ${fg(theme, "text", name)}${count > 1 ? ` ${fg(theme, "muted", `×${count}`)}` : ""}`);
	}

	if (toolLineParts.length > 0 || activeAgents > 0 || completedAgents > 0) {
		lines.push(fg(theme, "dim", "─".repeat(67)));
		if (toolLineParts.length > 0) lines.push(toolLineParts.join(` ${s} `));
		const agentParts: string[] = [];
		if (activeAgents > 0) agentParts.push(`${fg(theme, "warning", I_RUN)} ${fg(theme, "accent", "agent")} ${fg(theme, "accent", `×${activeAgents}`)}`);
		if (completedAgents > 0) agentParts.push(`${fg(theme, "success", "✔")} ${fg(theme, "accent", "agent")} ${fg(theme, "accent", `×${completedAgents}`)}`);
		if (agentParts.length > 0) lines.push(agentParts.join(` ${s} `));
	}

	// ── Running tools ──
	const running = tools.filter(t => t.status === "running");
	for (const t of running.slice(-2)) {
		const elapsed = fmtDuration(Date.now() - t.startTime);
		const target = t.target ? `: ${shortenDisplayPath(t.target, homedir(), 22)}` : "";
		lines.push(`${fg(theme, "warning", I_RUN)} ${fg(theme, "accent", t.name)}${target} ${fg(theme, "dim", `(${elapsed})`)}`);
	}

	return lines;
}

// ── Refresh + entry ────────────────────────────────────────────────

function refreshHud(ctx: any) {
	buildHud(ctx).then(lines => {
		if (lines.length > 0) ctx.ui.setWidget("elias-statusline", lines, { placement: "belowEditor" });
	}).catch(() => {});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		sessionStartTime = Date.now();
		turnIndex = 0;
		cwd = ctx.cwd;
		agents = [];
		tools = [];
		if (ctx.model) {
			modelProvider = (ctx.model as any).provider ?? "";
			modelId = (ctx.model as any).id ?? "";
		}
		thinkingLevel = pi.getThinkingLevel?.() ?? "";
		refreshHud(ctx);
	});

	pi.on("model_select", (event, ctx) => {
		if (event.model) {
			modelProvider = (event.model as any).provider ?? "";
			modelId = (event.model as any).id ?? "";
		}
		refreshHud(ctx);
	});

	pi.on("turn_start", (_event, ctx) => {
		turnIndex = (_event as any).turnIndex ?? (turnIndex + 1);
		refreshHud(ctx);
	});

	pi.on("tool_call", (event, ctx) => {
		const tool: ToolRecord = { name: event.toolName, target: null, status: "running", startTime: Date.now() };
		if (event.input && typeof event.input === "object") {
			const inp = event.input as Record<string, unknown>;
			if (typeof inp.path === "string") tool.target = inp.path;
			else if (typeof inp.filePath === "string") tool.target = inp.filePath;
		}
		tools.push(tool);
		// ponytail: cap at 500 to prevent unbounded growth over long sessions
		if (tools.length > 500) tools = tools.slice(-400);
		refreshHud(ctx);
	});

	pi.on("tool_result", (event, ctx) => {
		for (let i = tools.length - 1; i >= 0; i--) {
			if (tools[i]!.name === event.toolName && tools[i]!.status === "running") {
				tools[i]!.status = event.isError ? "error" : "completed";
				tools[i]!.endTime = Date.now();
				break;
			}
		}
		refreshHud(ctx);
	});

	pi.on("agent_start", (_event, ctx) => {
		agents.push({ status: "running", startTime: Date.now() });
		refreshHud(ctx);
	});

	pi.on("agent_end", (_event, ctx) => {
		const running = agents.find(a => a.status === "running");
		if (running) {
			running.status = "completed";
			running.endTime = Date.now();
		}
		refreshHud(ctx);
	});

	pi.on("thinking_level_select", (event, ctx) => {
		thinkingLevel = (event as any).level ?? thinkingLevel;
		refreshHud(ctx);
	});

	pi.on("turn_end", (_event, ctx) => refreshHud(ctx));
}
