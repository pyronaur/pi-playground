import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { PlaygroundSessionState } from "../models/playground-session-state.ts";

const WIDGET_KEY = "pi-playground";
const SOFT_PASTEL_PURPLE = "\u001b[38;2;214;188;250m";
const RESET = "\u001b[0m";

type WidgetCtx = Pick<ExtensionContext, "hasUI" | "ui" | "cwd">;

function clampEditorPadding(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, Math.min(3, Math.floor(value)));
}

function readEditorPadding(path: string): number | undefined {
	if (!existsSync(path)) {
		return undefined;
	}

	try {
		const text = readFileSync(path, "utf8");
		const parsed = JSON.parse(text) as { editorPaddingX?: unknown };
		if (!("editorPaddingX" in parsed)) {
			return undefined;
		}

		return clampEditorPadding(parsed.editorPaddingX);
	} catch {
		return undefined;
	}
}

function getEditorPaddingX(cwd: string): number {
	const globalPadding = readEditorPadding(join(homedir(), ".pi", "agent", "settings.json")) ?? 0;
	const projectPadding = readEditorPadding(join(cwd, ".pi", "settings.json"));
	return projectPadding ?? globalPadding;
}

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
