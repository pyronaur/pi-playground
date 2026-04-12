import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { RequestDebugger } from "../modules/request-debugger.ts";

import { clearPlaygroundBadge, showPlaygroundBadge } from "./badge.ts";

export function registerPlayground(pi: ExtensionAPI) {
	const requestDebugger = new RequestDebugger();

	pi.registerCommand("debug-playground", {
		description: "Toggle provider request debugging",
		handler: async (_args, ctx) => {
			const result = requestDebugger.toggle(ctx);
			if (result.enabled) {
				showPlaygroundBadge(ctx);
				return;
			}

			clearPlaygroundBadge();
		},
	});

	pi.on("session_start", (event, ctx) => {
		requestDebugger.onSessionStart(event, ctx);
		if (!ctx.hasUI) return;

		clearPlaygroundBadge();
		if (requestDebugger.isEnabled()) {
			showPlaygroundBadge(ctx);
		}

		ctx.ui.notify(`pi-playground loaded (${event.reason})`, "info");
	});

	pi.on("turn_start", (event) => {
		requestDebugger.onTurnStart(event);
	});

	pi.on("before_provider_request", async (event, ctx) => {
		await requestDebugger.recordBeforeProviderRequest(event, ctx);
	});

	pi.on("session_shutdown", () => {
		requestDebugger.onSessionShutdown();
		clearPlaygroundBadge();
	});
}
