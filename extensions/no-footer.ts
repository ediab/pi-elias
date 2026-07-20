// no-footer — hide pi's built-in footer/statusline so only extension statuslines
// (e.g. pi-shannon-statusline's belowEditor widget) render.
//
// pi ignores `footer: false` in settings.json — it's not a recognized key and the
// built-in FooterComponent is always added. ctx.ui.setFooter(factory) is the only
// way to replace it: a factory whose render() returns [] draws zero lines.
// Re-applied on every session_start (startup/new/resume/fork/reload).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter(() => ({ invalidate() {}, render: () => [] }));
	});
}
