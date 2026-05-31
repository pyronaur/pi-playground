import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Key,
	matchesKey,
	SelectList,
	type TUI,
} from "@earendil-works/pi-tui";

import {
	createKitchenSinkDemo,
	type DemoComponent,
	type DemoHost,
} from "./kitchen-sink-components.ts";
import { KITCHEN_SINK_PRESET_COUNT, type Preset, PRESETS } from "./kitchen-sink-data.ts";
import { selectListTheme, type Theme } from "./kitchen-sink-theme.ts";

export { KITCHEN_SINK_PRESET_COUNT } from "./kitchen-sink-data.ts";

function closeKey(data: string): boolean {
	return matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c") || matchesKey(data, "q");
}

function selectedPreset(index: number): Preset {
	return PRESETS[index] ?? PRESETS[0] ?? {
		id: "empty",
		label: "Empty",
		description: "No presets registered.",
		source: "none",
		use: "none",
	};
}

export class KitchenSinkGallery implements Component, Focusable {
	focused = false;
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly ctx: Pick<ExtensionContext, "ui">;
	private readonly done: () => void;
	private readonly catalog: SelectList;
	private activePreset: Preset | undefined;
	private activeDemo: DemoComponent | undefined;
	private catalogIndex = 0;

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
		this.catalog = new SelectList(PRESETS.map((preset) => ({
			value: preset.id,
			label: preset.label,
			description: preset.description,
		})), Math.min(KITCHEN_SINK_PRESET_COUNT, 13), selectListTheme(theme));
		this.catalog.onSelectionChange = (item) => {
			const index = PRESETS.findIndex((preset) => preset.id === item.value);
			this.catalogIndex = Math.max(0, index);
		};
		this.catalog.onSelect = (item) => this.openPreset(item.value);
		this.catalog.onCancel = done;
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
		if (!this.activeDemo || !this.activePreset) {
			const preset = selectedPreset(this.catalogIndex);
			return [
				this.theme.fg("accent", this.theme.bold("Kitchen Sink")),
				this.theme.fg("dim", "Real Pi TUI component/API preset library."),
				this.theme.fg("dim", "↑↓ navigate • Enter preview • Esc close"),
				"",
				...this.catalog.render(width),
				"",
				this.theme.fg("accent", preset.source),
				this.theme.fg("dim", preset.use),
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
		this.catalog.invalidate();
		this.activeDemo?.invalidate();
	}

	dispose(): void {
		this.activeDemo?.dispose?.();
	}

	private handleCatalogInput(data: string): void {
		if (closeKey(data)) {
			this.close();
			return;
		}
		this.catalog.handleInput(data);
		this.tui.requestRender();
	}

	private openPreset(id: string): void {
		this.activeDemo?.dispose?.();
		this.activePreset = PRESETS.find((preset) => preset.id === id);
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
		this.tui.requestRender();
	}

	private close(): void {
		this.activeDemo?.dispose?.();
		this.activeDemo = undefined;
		this.activePreset = undefined;
		this.done();
	}
}
