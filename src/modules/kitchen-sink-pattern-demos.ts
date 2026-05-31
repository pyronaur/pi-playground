import { type Component, Key, matchesKey, Text } from "@earendil-works/pi-tui";

import { ORDERED_ROWS, TREE_ROWS } from "./kitchen-sink-data.ts";
import {
	box,
	closeKey,
	type DemoComponent,
	type DemoHost,
	printLine,
} from "./kitchen-sink-demo-kit.ts";

function moveCursor(data: string, current: number, max: number): number {
	if (matchesKey(data, Key.up)) return Math.max(0, current - 1);
	if (matchesKey(data, Key.down)) return Math.min(max, current + 1);
	return current;
}

function handleListInput(
	data: string,
	host: DemoHost,
	cursor: number,
	max: number,
	actions: {
		onSpace: () => void;
		onEnter: () => void;
		onOther?: (cursor: number) => void;
	},
): number | undefined {
	if (closeKey(data)) {
		host.close();
		return undefined;
	}
	const next = moveCursor(data, cursor, max);
	if (matchesKey(data, Key.space)) actions.onSpace();
	if (matchesKey(data, Key.enter)) actions.onEnter();
	actions.onOther?.(next);
	host.requestRender();
	return next;
}

class TreeActionDemo implements Component {
	private readonly host: DemoHost;
	private cursor = 0;
	private selected = new Set<string>();
	private result = "No tree action yet.";

	constructor(host: DemoHost) {
		this.host = host;
	}

	handleInput(data: string): void {
		const next = handleListInput(data, this.host, this.cursor, TREE_ROWS.length - 1, {
			onSpace: () => this.toggle(),
			onEnter: () => {
				this.result = `Applied action to ${this.selected.size} rows.`;
			},
			onOther: (cursor) => {
				if (matchesKey(data, "?")) {
					this.result = `Details for ${TREE_ROWS[cursor]?.label ?? "row"}.`;
				}
			},
		});
		if (next !== undefined) this.cursor = next;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return [
			this.host.theme.bold("Source: pi-janitor style custom tree component"),
			this.host.theme.fg("dim", "↑↓ move • Space select • Enter action • ? details"),
			...TREE_ROWS.map((row, index) => {
				const mark = index === this.cursor ? this.host.theme.fg("accent", ">") : " ";
				const selected = this.selected.has(row.id) ? this.host.theme.fg("success", "●") : "○";
				return printLine(`${mark} ${"  ".repeat(row.depth)}${selected} ${row.label}`, width);
			}),
			this.host.theme.fg("success", this.result),
		];
	}

	private toggle(): void {
		const id = TREE_ROWS[this.cursor]?.id;
		if (!id) return;
		if (this.selected.has(id)) {
			this.selected.delete(id);
			return;
		}
		this.selected.add(id);
	}
}

class OrderedMultiSelectDemo implements Component {
	private readonly host: DemoHost;
	private cursor = 0;
	private selected: string[] = [];
	private result = "No ordered selection yet.";

	constructor(host: DemoHost) {
		this.host = host;
	}

	handleInput(data: string): void {
		const next = handleListInput(data, this.host, this.cursor, ORDERED_ROWS.length - 1, {
			onSpace: () => this.toggle(),
			onEnter: () => {
				this.result = `Accepted ${this.selected.join(", ") || "nothing"}.`;
			},
			onOther: () => {
				if (matchesKey(data, "u")) this.move(-1);
				if (matchesKey(data, "d")) this.move(1);
			},
		});
		if (next !== undefined) this.cursor = next;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return [
			this.host.theme.bold("Source: pi-extension-settings ordered multi-select style"),
			this.host.theme.fg("dim", "↑↓ move • Space toggle • u/d reorder selected • Enter accept"),
			...ORDERED_ROWS.map((row, index) => {
				const order = this.selected.indexOf(row);
				const badge = order >= 0
					? this.host.theme.fg("success", String(order + 1).padStart(2, "0"))
					: "  ";
				const mark = index === this.cursor ? this.host.theme.fg("accent", ">") : " ";
				return printLine(`${mark} ${badge} ${row}`, width);
			}),
			this.host.theme.fg("success", this.result),
		];
	}

	private toggle(): void {
		const value = ORDERED_ROWS[this.cursor];
		if (!value) return;
		if (this.selected.includes(value)) {
			this.selected = this.selected.filter((item) => item !== value);
			return;
		}
		this.selected = [...this.selected, value];
	}

	private move(delta: number): void {
		const value = ORDERED_ROWS[this.cursor];
		if (!value) return;
		const current = this.selected.indexOf(value);
		if (current < 0) return;
		const next = Math.max(0, Math.min(this.selected.length - 1, current + delta));
		const items = [...this.selected];
		items.splice(current, 1);
		items.splice(next, 0, value);
		this.selected = items;
	}
}

class FocusPanel implements Component {
	handle?: { isFocused(): boolean };
	private readonly host: DemoHost;
	private readonly label: string;
	private value = 0;

	constructor(host: DemoHost, label: string) {
		this.host = host;
		this.label = label;
	}

	handleInput(data: string): void {
		if (!matchesKey(data, Key.enter)) return;
		this.value += 1;
		this.host.requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		return box([
			this.handle?.isFocused()
				? this.host.theme.fg("success", "focused")
				: this.host.theme.fg("dim", "passive"),
			`value: ${this.value}`,
		], width, this.label, this.host.theme);
	}
}

class FocusWorkspaceDemo implements Component {
	private readonly host: DemoHost;
	private readonly panels: FocusPanel[] = [];
	private readonly handles: Array<
		{ hide(): void; focus(): void; unfocus(): void; isFocused(): boolean }
	> = [];
	private focusIndex = -1;

	constructor(host: DemoHost) {
		this.host = host;
		for (const [index, label] of ["Navigator", "Inspector", "Actions"].entries()) {
			const panel = new FocusPanel(host, label);
			const handle = host.tui.showOverlay(panel, {
				nonCapturing: true,
				row: 2 + index * 3,
				col: 4 + index * 10,
				width: 28,
			});
			panel.handle = handle;
			this.panels.push(panel);
			this.handles.push(handle);
		}
	}

	handleInput(data: string): void {
		if (closeKey(data)) {
			this.host.close();
			return;
		}
		if (matchesKey(data, Key.tab)) this.cycle();
		this.host.requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		const focused = this.focusIndex < 0
			? "controller"
			: (this.panels[this.focusIndex] ? "panel" : "unknown");
		return [
			this.host.theme.bold("Source: TUI.showOverlay + OverlayHandle.focus"),
			`Focus: ${this.host.theme.fg("accent", focused)}`,
			"Three non-capturing overlays are live on top of the base TUI.",
			"Tab cycles focus; Enter mutates the focused panel.",
		].map((line) => printLine(line, width));
	}

	dispose(): void {
		for (const handle of this.handles) handle.hide();
	}

	private cycle(): void {
		if (this.focusIndex >= 0) this.handles[this.focusIndex]?.unfocus();
		this.focusIndex = this.focusIndex + 1 >= this.handles.length ? -1 : this.focusIndex + 1;
		if (this.focusIndex >= 0) this.handles[this.focusIndex]?.focus();
	}
}

class PowerBarDemo implements Component {
	private readonly host: DemoHost;
	private segments = [
		{ label: "mode", value: "play", visible: true },
		{ label: "ctx", value: "42%", visible: true },
		{ label: "model", value: "gpt-5", visible: true },
		{ label: "gate", value: "pass", visible: true },
	];
	private cursor = 0;
	private result = "Power bar widget installed above the editor.";

	constructor(host: DemoHost) {
		this.host = host;
		this.syncWidget();
	}

	handleInput(data: string): void {
		if (closeKey(data)) {
			this.host.close();
			return;
		}
		if (matchesKey(data, Key.left)) this.cursor = Math.max(0, this.cursor - 1);
		if (matchesKey(data, Key.right)) {
			this.cursor = Math.min(this.visibleSegments().length - 1, this.cursor + 1);
		}
		if (matchesKey(data, "v")) this.toggleVisible();
		if (matchesKey(data, Key.enter)) this.simulateEvent();
		this.syncWidget();
		this.host.requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		return [
			this.host.theme.bold("Source: ctx.ui.setWidget component factory, pi-powerbar style"),
			"Inspect the above-editor widget. Enter simulates an event; v toggles a segment.",
			this.host.theme.fg("success", this.result),
		].map((line) => printLine(line, width));
	}

	dispose(): void {
		this.host.ctx.ui.setWidget("kitchen-sink-powerbar", undefined);
	}

	private visibleSegments(): typeof this.segments {
		return this.segments.filter((segment) => segment.visible);
	}

	private syncWidget(): void {
		const line = this.visibleSegments().map((segment, index) => {
			const value = `${segment.label}:${segment.value}`;
			return index === this.cursor ? this.host.theme.fg("accent", `[${value}]`) : value;
		}).join("  ");
		this.host.ctx.ui.setWidget("kitchen-sink-powerbar", () => new Text(line), {
			placement: "aboveEditor",
		});
	}

	private simulateEvent(): void {
		const segment = this.visibleSegments()[this.cursor];
		if (!segment) return;
		segment.value = segment.value === "pass" ? "warn" : String(Date.now()).slice(-3);
		this.result = `Event updated ${segment.label}.`;
	}

	private toggleVisible(): void {
		const segment = this.visibleSegments()[this.cursor];
		if (!segment) return;
		segment.visible = false;
		this.cursor = 0;
		this.result = `Hid ${segment.label}.`;
	}
}

function createPatternDemo(id: string, host: DemoHost): DemoComponent | undefined {
	if (id === "tree-action-overlay") return new TreeActionDemo(host);
	if (id === "ordered-multi-select-reorder-panel") return new OrderedMultiSelectDemo(host);
	if (id === "overlay-focus-cycling-workspace") return new FocusWorkspaceDemo(host);
	if (id === "event-fed-power-bar") return new PowerBarDemo(host);
	return undefined;
}

export { createPatternDemo };
