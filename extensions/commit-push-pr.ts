/**
 * /commit-push-pr — commit changes, push, and open a PR
 *
 * Gathers git context (status, diff, branch) and injects a prompt
 * into the editor instructing the LLM to create a meaningful commit,
 * push to origin, and open a PR via `gh pr create`.
 *
 * Ported from:
 * https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/.claude/commands/commit-push-pr.md
 */

import { execSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function exec(cmd: string, cwd: string): string {
	try {
		return execSync(cmd, {
			encoding: "utf8",
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
			maxBuffer: 512 * 1024,
		}).trim();
	} catch {
		return "";
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("commit-push-pr", {
		description: "Commit changes, push, and open a PR",
		handler: async (_args, ctx) => {
			const cwd = ctx.cwd;
			const status = exec("git status", cwd);
			const diff = exec("git diff HEAD", cwd);
			const diffStaged = exec("git diff --staged", cwd);
			const branch = exec("git branch --show-current", cwd);
			const remote = exec("git remote get-url origin", cwd) || "origin";

			const combinedDiff = [diffStaged, diff].filter(Boolean).join("\n");

			const prompt = [
				"## Git context",
				"",
				`- Current branch: **${branch}**`,
				`- Remote: ${remote}`,
				"",
				"```",
				status,
				"```",
				"",
				"## Changes",
				"",
				"```diff",
				combinedDiff || "(no changes detected)",
				"```",
				"",
				"## Task",
				"",
				`1. If on \`main\` or \`master\`, create a feature branch with a meaningful name based on the changes`,
				"2. Stage all changes: `git add -A`",
				"3. Create a single commit with a clear, descriptive message",
				"4. Push the branch to origin",
				"5. Create a PR using `gh pr create` — include a meaningful title and body from the commit/diff context",
				"",
				"Do everything in one response. Do not ask for confirmation.",
			].join("\n");

			ctx.ui.setEditorText(prompt);
		},
	});
}
