import {
	type Component,
	Input,
	Key,
	matchesKey,
	SelectList,
	type SettingItem,
	SettingsList,
} from "@earendil-works/pi-tui";

import { SEARCH_ITEMS, SELECT_ROWS } from "./kitchen-sink-data.ts";
import { closeKey, type DemoComponent, type DemoHost } from "./kitchen-sink-demo-kit.ts";
import { selectListTheme, settingsListTheme } from "./kitchen-sink-theme.ts";

class SelectCardDemo implements Component {
	private readonly host: DemoHost;
	private readonly list: SelectList;
	private result = "No selection yet.";

	constructor(host: DemoHost) {
		this.host = host;
		this.list = new SelectList(SELECT_ROWS.map((row) => ({
			value: row.label,
			label: row.label,
			description: row.description,
		})), SELECT_ROWS.length, selectListTheme(host.theme));
		this.list.onSelect = (item) => {
			this.result = `Selected ${item.label}.`;
			this.host.requestRender();
		};
		this.list.onCancel = host.close;
	}

	handleInput(data: string): void {
		this.list.handleInput(data);
		this.host.requestRender();
	}

	invalidate(): void {
		this.list.invalidate();
	}

	render(width: number): string[] {
		return [
			this.host.theme.bold("Source: SelectList"),
			...this.list.render(width),
			this.host.theme.fg("success", this.result),
		];
	}
}

class InlineInputDemo implements Component {
	private readonly host: DemoHost;
	private readonly input = new Input();
	private result = "No submitted value yet.";

	constructor(host: DemoHost) {
		this.host = host;
		this.input.focused = true;
		this.input.onSubmit = (value) => {
			this.result = `Submitted ${value || "(empty)"}.`;
			this.host.requestRender();
		};
		this.input.onEscape = host.close;
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
		this.host.requestRender();
	}

	invalidate(): void {
		this.input.invalidate();
	}

	render(width: number): string[] {
		return [
			this.host.theme.bold("Source: Input"),
			this.host.theme.fg("dim", "Name this preset usage:"),
			...this.input.render(width),
			this.host.theme.fg("success", this.result),
		];
	}
}

class SearchPreviewDemo implements Component {
	private readonly host: DemoHost;
	private readonly input = new Input();
	private readonly list: SelectList;
	private selected = SEARCH_ITEMS[0];
	private result = "No action yet.";

	constructor(host: DemoHost) {
		this.host = host;
		this.input.focused = true;
		this.list = new SelectList(SEARCH_ITEMS.map((item) => ({
			value: item.label,
			label: item.label,
			description: item.detail,
		})), 6, selectListTheme(host.theme));
		this.list.onSelectionChange = (item) => {
			this.selected = SEARCH_ITEMS.find((candidate) => candidate.label === item.value);
		};
		this.list.onSelect = (item) => {
			this.result = `Applied ${item.label}.`;
			this.host.requestRender();
		};
	}

	handleInput(data: string): void {
		if (closeKey(data)) {
			this.host.close();
			return;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, Key.down) || matchesKey(data, Key.enter)) {
			this.list.handleInput(data);
			this.host.requestRender();
			return;
		}
		if (matchesKey(data, "a")) {
			this.result = `Alternate action for ${this.selected?.label ?? "nothing"}.`;
			this.host.requestRender();
			return;
		}
		this.input.handleInput(data);
		this.list.setFilter(this.input.getValue());
		this.host.requestRender();
	}

	invalidate(): void {
		this.input.invalidate();
		this.list.invalidate();
	}

	render(width: number): string[] {
		return [
			this.host.theme.bold("Source: Input + SelectList filter"),
			this.host.theme.fg("dim", "Filter:"),
			...this.input.render(width),
			...this.list.render(width),
			this.host.theme.bold("Preview"),
			this.selected?.detail ?? this.host.theme.fg("warning", "No matching item."),
			this.host.theme.fg("success", this.result),
		];
	}
}

class StringSettingInput implements Component {
	private readonly done: (value?: string) => void;
	private readonly input = new Input();

	constructor(value: string, done: (value?: string) => void) {
		this.done = done;
		this.input.setValue(value);
		this.input.focused = true;
		this.input.onSubmit = done;
		this.input.onEscape = () => done(undefined);
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
	}

	invalidate(): void {
		this.input.invalidate();
	}

	render(width: number): string[] {
		return ["Edit value:", ...this.input.render(width)];
	}
}

class SettingsPanelDemo implements Component {
	private readonly host: DemoHost;
	private readonly settings: SettingsList;
	private result = "No setting changed yet.";

	constructor(host: DemoHost) {
		this.host = host;
		const items: SettingItem[] = [
			{
				id: "playground",
				label: "Playground enabled",
				description: "Finite value row cycled by SettingsList.",
				currentValue: "on",
				values: ["on", "off"],
			},
			{
				id: "logging",
				label: "Request logging",
				description: "Finite value row cycled by SettingsList.",
				currentValue: "off",
				values: ["on", "off"],
			},
			{
				id: "accent",
				label: "Preset accent",
				description: "Submenu row backed by an Input component.",
				currentValue: "purple",
				submenu: (value, done) => new StringSettingInput(value, done),
			},
		];
		this.settings = new SettingsList(
			items,
			8,
			settingsListTheme(host.theme),
			(id, value) => {
				this.result = `${id} = ${value}`;
				this.host.requestRender();
			},
			host.close,
			{ enableSearch: true },
		);
	}

	handleInput(data: string): void {
		this.settings.handleInput(data);
		this.host.requestRender();
	}

	invalidate(): void {
		this.settings.invalidate();
	}

	render(width: number): string[] {
		return [
			this.host.theme.bold("Source: SettingsList + Input submenu"),
			...this.settings.render(width),
			this.host.theme.fg("success", this.result),
		];
	}
}

function createControlDemo(id: string, host: DemoHost): DemoComponent | undefined {
	if (id === "modal-select-card") return new SelectCardDemo(host);
	if (id === "inline-input-overlay") return new InlineInputDemo(host);
	if (id === "search-preview-overlay") return new SearchPreviewDemo(host);
	if (id === "searchable-settings-panel") return new SettingsPanelDemo(host);
	return undefined;
}

export { createControlDemo };
