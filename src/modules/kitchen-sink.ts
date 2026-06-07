import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Input,
	Key,
	matchesKey,
	SelectList,
	truncateToWidth,
	type TUI,
	visibleWidth,
} from "@earendil-works/pi-tui";

import {
	createKitchenSinkDemo,
	type DemoComponent,
	type DemoHost,
} from "./kitchen-sink-components.ts";
import { type Preset, PRESETS } from "./kitchen-sink-data.ts";
import { selectListTheme, type Theme } from "./kitchen-sink-theme.ts";

export { KITCHEN_SINK_PRESET_COUNT } from "./kitchen-sink-data.ts";

function closeKey(data: string): boolean {
	return matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c");
}

function pad(value: string, width: number): string {
	return value + " ".repeat(Math.max(0, width - visibleWidth(value)));
}

export class KitchenSinkGallery implements Component, Focusable {
	private isFocused = false;
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly ctx: Pick<ExtensionContext, "ui">;
	private readonly done: () => void;
	private readonly searchInput = new Input();
	private catalog: SelectList;
	private activePreset: Preset | undefined;
	private activeDemo: DemoComponent | undefined;

	get focused(): boolean {
		return this.isFocused;
	}

	set focused(value: boolean) {
		this.isFocused = value;
		this.searchInput.focused = value && !this.activeDemo;
	}

	constructor(
		tui: TUI,
		theme: Theme,
		ctx: Pick<ExtensionContext, "ui">,
		done: () => void,
	) {
		this.tui = tui;
		this.theme = theme;
		this.ctx = ctx;
		this.done = done;
		this.catalog = this.createCatalog(PRESETS);
	}

	private createCatalog(presets: Preset[]): SelectList {
		const catalog = new SelectList(presets.map((preset) => ({
			value: preset.id,
			label: preset.label,
			description: preset.description,
		})), Math.min(Math.max(presets.length, 1), 13), selectListTheme(this.theme));
		catalog.onSelect = (item) => this.openPreset(item.value);
		catalog.onCancel = this.done;
		return catalog;
	}

	handleInput(data: string): void {
		if (!this.activeDemo) {
			this.handleCatalogInput(data);
			return;
		}
		if (matchesKey(data, "b")) {
			this.showCatalog();
			return;
		}
		if (matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.close();
			return;
		}
		this.activeDemo.handleInput?.(data);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const safeWidth = Math.max(12, width);
		const contentWidth = Math.max(1, safeWidth - 4);
		const content = this.renderContent(contentWidth);
		return this.renderFrame(content, safeWidth);
	}

	private renderContent(width: number): string[] {
		if (!this.activeDemo || !this.activePreset) {
			const preset = this.selectedCatalogPreset();
			return [
				this.theme.fg("accent", this.theme.bold("Kitchen Sink")),
				this.theme.fg("dim", "Real Pi TUI component/API preset library."),
				this.theme.fg("dim", "type search • ↑↓ navigate • Enter preview • Esc clear/close"),
				"",
				this.theme.fg("dim", "Search"),
				...this.searchInput.render(width),
				"",
				...this.catalog.render(width),
				"",
				...(preset
					? [
						this.theme.fg("accent", preset.source),
						this.theme.fg("dim", preset.use),
					]
					: [
						this.theme.fg("warning", "No matching preset."),
						this.theme.fg("dim", "Try a different search."),
					]),
			];
		}

		return [
			this.theme.fg("accent", this.theme.bold(this.activePreset.label)),
			this.theme.fg("dim", this.activePreset.description),
			this.theme.fg("dim", `source: ${this.activePreset.source}`),
			this.theme.fg("dim", `use when: ${this.activePreset.use}`),
			this.theme.fg("dim", "b catalog • Esc preset close • q close"),
			"",
			...this.activeDemo.render(width),
		];
	}

	invalidate(): void {
		this.searchInput.invalidate();
		this.catalog.invalidate();
		this.activeDemo?.invalidate();
	}

	dispose(): void {
		this.activeDemo?.dispose?.();
	}

	private renderFrame(content: string[], width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const contentWidth = Math.max(1, width - 4);
		const body = ["", ...content, ""];
		const bodyLimit = Math.max(1, this.tui.terminal.rows - 2);
		const visibleBody = body.length > bodyLimit
			? [...body.slice(0, Math.max(0, bodyLimit - 1)), this.theme.fg("dim", "…")]
			: body;
		const rows = [...visibleBody];
		while (rows.length < bodyLimit) rows.push("");

		const border = (value: string) => this.theme.fg("dim", value);
		const title = truncateToWidth(" Kitchen Sink ", innerWidth, "…", true);
		const titleRule = "─".repeat(Math.max(0, innerWidth - visibleWidth(title)));
		const top = border("╭") + this.theme.fg("accent", title) + border(`${titleRule}╮`);
		const bottom = border(`╰${"─".repeat(innerWidth)}╯`);

		return [
			this.paint(top, width),
			...rows.map((line) => {
				const text = truncateToWidth(line, contentWidth, "…", true);
				return this.paint(`${border("│")} ${pad(text, contentWidth)} ${border("│")}`, width);
			}),
			this.paint(bottom, width),
		];
	}

	private paint(line: string, width: number): string {
		return pad(line, width);
	}

	private handleCatalogInput(data: string): void {
		if (matchesKey(data, Key.escape) && this.searchInput.getValue()) {
			this.searchInput.setValue("");
			this.syncCatalog();
			this.tui.requestRender();
			return;
		}
		if (closeKey(data)) {
			this.close();
			return;
		}
		this.catalog.handleInput(data);
		if (matchesKey(data, Key.up) || matchesKey(data, Key.down) || matchesKey(data, Key.enter)) {
			this.tui.requestRender();
			return;
		}

		const before = this.searchInput.getValue();
		this.searchInput.handleInput(data);
		if (this.searchInput.getValue() !== before) this.syncCatalog();
		this.tui.requestRender();
	}

	private openPreset(id: string): void {
		this.activeDemo?.dispose?.();
		this.activePreset = PRESETS.find((preset) => preset.id === id);
		this.searchInput.focused = false;
		const host: DemoHost = {
			tui: this.tui,
			theme: this.theme,
			ctx: this.ctx,
			close: () => this.close(),
			requestRender: () => this.tui.requestRender(),
		};
		this.activeDemo = createKitchenSinkDemo(id, host);
		this.tui.requestRender();
	}

	private showCatalog(): void {
		this.activeDemo?.dispose?.();
		this.activeDemo = undefined;
		this.activePreset = undefined;
		this.searchInput.focused = this.focused;
		this.tui.requestRender();
	}

	private close(): void {
		this.activeDemo?.dispose?.();
		this.activeDemo = undefined;
		this.activePreset = undefined;
		this.done();
	}

	private selectedCatalogPreset(): Preset | undefined {
		const selected = this.catalog.getSelectedItem();
		return PRESETS.find((preset) => preset.id === selected?.value);
	}

	private syncCatalog(): void {
		this.catalog = this.createCatalog(this.filteredPresets());
	}

	private filteredPresets(): Preset[] {
		const query = this.searchInput.getValue().trim().toLowerCase();
		if (!query) return PRESETS;

		return PRESETS.filter((preset) =>
			[
				preset.id,
				preset.label,
				preset.description,
				preset.source,
				preset.use,
			].some((value) => value.toLowerCase().includes(query))
		);
	}
}
