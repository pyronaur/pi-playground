import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { PlaygroundSessionState } from "../models/playground-session-state.ts";
import { getEditorPaddingX } from "../modules/editor-padding.ts";

const WIDGET_KEY = "pi-playground";
const SOFT_PASTEL_PURPLE = "\u001b[38;2;214;188;250m";
const RESET = "\u001b[0m";

type WidgetCtx = Pick<ExtensionContext, "hasUI" | "ui" | "cwd">;

function renderLabel(): string {
	return `${SOFT_PASTEL_PURPLE}Playground${RESET}`;
}

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

	const editorPaddingX = getEditorPaddingX(ctx.cwd);
	ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
		render(): string[] {
			const pad = " ".repeat(editorPaddingX);
			const label = renderLabel();
			if (!state.requestLogging) {
				return [`${pad}${label}`];
			}

			return [
				`${pad}${label} ${theme.fg("dim", "·")} ${theme.fg("muted", "request logging")}`,
			];
		},
		invalidate() {},
	}));
}
