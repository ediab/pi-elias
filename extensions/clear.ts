// /clear — clear the conversation and start a fresh session (alias for /new).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("clear", {
		description: "Clear the conversation and start a fresh session (like /new)",
		handler: async (_args, ctx) => {
			await ctx.newSession();
		},
	});
}
