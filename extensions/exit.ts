// /exit — quit pi (alias for /quit).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("exit", {
		description: "Quit pi (like /quit)",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});
}
