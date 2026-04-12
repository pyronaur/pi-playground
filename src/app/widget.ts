import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { PlaygroundSessionState } from "../models/playground-session-state.ts";

const WIDGET_KEY = "pi-playground";

type WidgetCtx = Pick<ExtensionContext, "hasUI" | "ui">;

export function clearPlaygroundWidget(ctx: WidgetCtx): void {
	if (!ctx.hasUI) {
		return;
	}

	ctx.ui.setWidget(WIDGET_KEY, undefined);
}

export function syncPlaygroundWidget(ctx: WidgetCtx, state: PlaygroundSessionState): void {
	if (!ctx.hasUI || !state.active) {
		clearPlaygroundWidget(ctx);
		return;
	}

	ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
		render(): string[] {
			const label = theme.fg("accent", "Playground");
			if (!state.requestLogging) {
				return [label];
			}

			return [
				`${label} ${theme.fg("dim", "·")} ${theme.fg("muted", "request logging")}`,
			];
		},
		invalidate() {},
	}));
}
