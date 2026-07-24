/**
 * Plan-mode helpers. Bash allowlist for read-only enforcement, plus the
 * plan-file carve-out (the only writable target in plan mode).
 * Kept pure so the carve-out logic is unit-testable without the pi runtime.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";

export function projectPlansDir(): string {
	return nodePath.resolve(process.cwd(), ".pi", "plans");
}
export function globalPlansDir(): string {
	return nodePath.join(process.env.HOME ?? "", ".pi", "agent", "plans");
}
export function newPlanFilePath(): string {
	const id = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;
	const dir = projectPlansDir();
	nodeFs.mkdirSync(dir, { recursive: true });
	return nodePath.join(dir, `plan-${id}.md`);
}
// A path is writable in plan mode iff it IS or lives directly under the project or global
// plans dir. Use a trailing-sep guard so a sibling like `<cwd>/.pi/plans-evil/x` (which
// startsWith the `.pi/plans` prefix) is NOT accepted as a plan file.
export function isPlanFilePath(target: string): boolean {
	const abs = nodePath.isAbsolute(target) ? target : nodePath.resolve(process.cwd(), target);
	const within = (dir: string): boolean => abs === dir || abs.startsWith(dir + nodePath.sep);
	return within(projectPlansDir()) || within(globalPlansDir());
}

// Destructive commands blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

// Safe read-only commands allowed in plan mode
const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*eza\b/,
];

export function isSafeCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
	return !isDestructive && isSafe;
}

// ponytail: one runnable self-check for the plan-file carve-out + bash allowlist.
// Guarded by import.meta.main so it only runs when this file is the entry script
// (bun utils.ts), never when pi's jiti imports it as a module.
if ((import.meta as unknown as { main?: boolean }).main) {
	const cwd = process.cwd();
	const eq = (a: unknown, b: unknown, msg: string): void => {
		if (a !== b) {
			console.error(`FAIL: ${msg} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
			process.exit(1);
		}
	};
	eq(isPlanFilePath(`${cwd}/.pi/plans/plan-abc.md`), true, "project plan file allowed");
	eq(isPlanFilePath(`${cwd}/.pi/plans-evil/x.md`), false, "sibling-prefix dir blocked");
	eq(isPlanFilePath(`${cwd}/.pi/plans/nested/x.md`), true, "nested plan file allowed");
	eq(isPlanFilePath(`${cwd}/src/index.ts`), false, "src file blocked");
	eq(isPlanFilePath("/etc/passwd"), false, "/etc/passwd blocked");
	eq(isSafeCommand("ls -la"), true, "ls allowed");
	eq(isSafeCommand("git status"), true, "git status allowed");
	eq(isSafeCommand("rm -rf /"), false, "rm blocked");
	eq(isSafeCommand("git commit -m x"), false, "git commit blocked");
	eq(isSafeCommand("npm install"), false, "npm install blocked");
	console.log("plan-mode utils ok");
}