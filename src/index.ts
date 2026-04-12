import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { RequestDebugger } from "./request-debugger.ts";

const LABEL = "Playground";
const SOFT_GREEN = "\u001b[38;2;166;219;180m";
const RESET = "\u001b[0m";

let closeBadge: (() => void) | undefined;
let badgeHandle: { focus?: () => void } | undefined;

type BadgeCtx = Pick<ExtensionContext, "hasUI" | "ui">;

function clearBadge() {
	if (!closeBadge) return;

	const close = closeBadge;
	closeBadge = undefined;
	badgeHandle?.focus?.();
	badgeHandle = undefined;
	close();
}

function makeBadge(theme: { fg(name: string, text: string): string }) {
	return {
		render(width: number) {
			const top = " ".repeat(width);
			const text = `  ${SOFT_GREEN}${LABEL}${RESET}`;
			const pad = " ".repeat(Math.max(0, width - 2 - LABEL.length));
			const line = theme.fg("dim", "─".repeat(width));
			return [top, text + pad, line];
		},
		invalidate() {},
	};
}

function showBadge(ctx: BadgeCtx) {
	if (!ctx.hasUI || closeBadge) return;

	void ctx.ui.custom(
		(_tui, theme, _keybindings, done) => {
			closeBadge = () => done(undefined);
			return makeBadge(theme);
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "top-left",
				width: "100%",
				margin: 0,
				offsetX: 0,
				offsetY: 0,
				nonCapturing: true,
			},
			onHandle: (handle) => {
				badgeHandle = handle;
			},
		},
	).catch(() => {});
}

export default function register(pi: ExtensionAPI) {
	const requestDebugger = new RequestDebugger();

	pi.registerCommand("debug-playground", {
		description: "Toggle provider request debugging",
		handler: async (_args, ctx) => {
			const result = requestDebugger.toggle(ctx);
			if (result.enabled) {
				showBadge(ctx);
				return;
			}

			clearBadge();
		},
	});

	pi.on("session_start", (event, ctx) => {
		requestDebugger.onSessionStart(event, ctx);
		if (!ctx.hasUI) return;

		clearBadge();
		if (requestDebugger.isEnabled()) {
			showBadge(ctx);
		}

		ctx.ui.notify(`pi-playground loaded (${event.reason})`, "info");
	});

	pi.on("turn_start", (event) => {
		requestDebugger.onTurnStart(event);
	});

	pi.on("before_provider_request", async (event, ctx) => {
		await requestDebugger.recordBeforeProviderRequest(event, ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		requestDebugger.onSessionShutdown();
		if (!ctx.hasUI) return;
		clearBadge();
	});
}
