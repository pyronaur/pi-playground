import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Key,
	matchesKey,
	truncateToWidth,
	type TUI,
	visibleWidth,
} from "@earendil-works/pi-tui";

import type { Theme } from "./kitchen-sink-theme.ts";

type DemoHost = {
	tui: TUI;
	theme: Theme;
	ctx: Pick<ExtensionContext, "ui">;
	close: () => void;
	requestRender: () => void;
};

type DemoComponent = Component & {
	dispose?(): void;
};

function closeKey(data: string): boolean {
	return matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c");
}

function printLine(value: string, width: number): string {
	return truncateToWidth(value, width, "…", true);
}

function pad(value: string, width: number): string {
	return value + " ".repeat(Math.max(0, width - visibleWidth(value)));
}

function box(lines: string[], width: number, title: string, theme: Theme): string[] {
	const safeWidth = Math.max(8, width);
	const inner = safeWidth - 2;
	const border = (value: string) => theme.fg("dim", value);
	const label = truncateToWidth(` ${title} `, inner, "…", true);
	const labelPad = "─".repeat(Math.max(0, inner - visibleWidth(label)));
	return [
		border("╭") + theme.fg("accent", label) + border(`${labelPad}╮`),
		...lines.map((line) => border("│") + pad(printLine(line, inner), inner) + border("│")),
		border(`╰${"─".repeat(inner)}╯`),
	];
}

export type { DemoComponent, DemoHost };
export { box, closeKey, printLine };
