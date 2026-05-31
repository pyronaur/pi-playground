import {
	type AutocompleteItem,
	type AutocompleteProvider,
	CancellableLoader,
	type Component,
	Editor,
	Key,
	matchesKey,
} from "@earendil-works/pi-tui";

import { autocompleteSuggestions } from "./kitchen-sink-data.ts";
import { closeKey, type DemoComponent, type DemoHost, printLine } from "./kitchen-sink-demo-kit.ts";
import { editorTheme } from "./kitchen-sink-theme.ts";

class LeaderHintDemo implements Component {
	private readonly host: DemoHost;
	private result = "Leader widget installed above the editor.";

	constructor(host: DemoHost) {
		this.host = host;
		this.syncWidget("pending");
	}

	handleInput(data: string): void {
		if (closeKey(data)) {
			this.host.close();
			return;
		}
		const actions = new Map([
			["g", "playground submenu"],
			["p", "prompt navigator"],
			["r", "request logging"],
			["k", "kitchen sink"],
		]);
		const action = data.length === 1 ? actions.get(data) : undefined;
		this.result = action ? `Ran ${action}.` : `No leader action for ${JSON.stringify(data)}.`;
		this.syncWidget(action ? "complete" : "pending");
		this.host.requestRender();
	}

	invalidate(): void {}

	render(width: number): string[] {
		return [
			this.host.theme.bold("Source: ctx.ui.setWidget + next-key handling"),
			"This preset uses the real widget API; inspect the above-editor widget.",
			"Press g/p/r/k to update the widget state.",
			this.host.theme.fg("success", this.result),
		].map((line) => printLine(line, width));
	}

	dispose(): void {
		this.host.ctx.ui.setWidget("kitchen-sink-leader", undefined);
	}

	private syncWidget(state: "pending" | "complete"): void {
		const label = state === "pending" ? "leader" : "done";
		this.host.ctx.ui.setWidget("kitchen-sink-leader", [
			`▸ ${label}  g playground  p prompt  r requests  k kitchen`,
		], { placement: "aboveEditor" });
	}
}

class DraftEditorDemo implements Component {
	private readonly host: DemoHost;
	private readonly editor: Editor;
	private result = "No draft saved yet.";

	constructor(host: DemoHost) {
		this.host = host;
		this.editor = new Editor(host.tui, editorTheme(host.theme), { paddingX: 1 });
		this.editor.setText(
			"Draft a short instruction here.\nUse this preset when the user must review text before applying it.",
		);
		this.editor.focused = true;
		this.editor.disableSubmit = true;
		this.editor.onChange = () => host.requestRender();
	}

	handleInput(data: string): void {
		if (closeKey(data)) {
			this.host.close();
			return;
		}
		if (matchesKey(data, "ctrl+s")) {
			this.result = `Saved ${this.editor.getText().length} chars.`;
			this.host.requestRender();
			return;
		}
		if (matchesKey(data, "ctrl+g")) {
			this.result = "Cancelled draft changes.";
			this.host.requestRender();
			return;
		}
		this.editor.handleInput(data);
		this.host.requestRender();
	}

	invalidate(): void {
		this.editor.invalidate();
	}

	render(width: number): string[] {
		return [
			this.host.theme.bold("Source: Editor"),
			this.host.theme.fg("dim", "Ctrl+S save • Ctrl+G cancel • Esc close"),
			...this.editor.render(width),
			this.host.theme.fg("success", this.result),
		];
	}
}

class WizardDemo implements Component {
	private readonly host: DemoHost;
	private readonly editor: Editor;
	private step = 0;
	private option = 0;
	private inline = false;
	private result = "No answer yet.";

	constructor(host: DemoHost) {
		this.host = host;
		this.editor = new Editor(host.tui, editorTheme(host.theme), { paddingX: 1 });
		this.editor.focused = true;
		this.editor.disableSubmit = true;
	}

	handleInput(data: string): void {
		if (closeKey(data)) {
			if (!this.inline) {
				this.host.close();
				return;
			}
			this.inline = false;
			this.editor.setText("");
			this.host.requestRender();
			return;
		}
		if (this.inline) {
			if (matchesKey(data, Key.enter)) {
				this.result = `Custom answer: ${this.editor.getText() || "(empty)"}`;
				this.inline = false;
				this.editor.setText("");
				this.host.requestRender();
				return;
			}
			this.editor.handleInput(data);
			this.host.requestRender();
			return;
		}
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
			this.step = Math.min(2, this.step + 1);
		}
		if (matchesKey(data, Key.left)) this.step = Math.max(0, this.step - 1);
		if (matchesKey(data, Key.up)) this.option = Math.max(0, this.option - 1);
		if (matchesKey(data, Key.down)) this.option = Math.min(2, this.option + 1);
		if (matchesKey(data, Key.enter) && this.option === 2) this.inline = true;
		if (matchesKey(data, Key.enter) && this.option !== 2) {
			this.result = `Answered step ${this.step + 1}, option ${this.option + 1}.`;
		}
		this.host.requestRender();
	}

	invalidate(): void {
		this.editor.invalidate();
	}

	render(width: number): string[] {
		const steps = ["Intent", "Audience", "Finish"];
		const options = [
			["visual reference", "implementation guide", "custom..."],
			["future agent", "extension author", "custom..."],
			["save preset", "open preview", "custom..."],
		][this.step] ?? [];
		return [
			this.host.theme.bold("Source: question.ts/questionnaire.ts style component + Editor"),
			steps.map((step, index) =>
				index === this.step
					? this.host.theme.fg("accent", `[${step}]`)
					: this.host.theme.fg("dim", step)
			).join(" → "),
			...options.map((item, index) =>
				`${index === this.option ? this.host.theme.fg("accent", ">") : " "} ${item}`
			),
			...(this.inline ? ["Custom answer:", ...this.editor.render(width)] : []),
			this.host.theme.fg("success", this.result),
		];
	}
}

class ProgressDemo implements Component {
	private readonly host: DemoHost;
	private readonly loader: CancellableLoader;
	private state: "idle" | "running" | "cancelled" | "completed" = "idle";
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(host: DemoHost) {
		this.host = host;
		this.loader = new CancellableLoader(
			host.tui,
			(value) => host.theme.fg("accent", value),
			(value) => host.theme.fg("dim", value),
			"Kitchen sink action ready.",
		);
		this.loader.onAbort = () => this.cancel();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.enter) && this.state !== "running") {
			this.start();
			return;
		}
		if (closeKey(data) && this.state === "running") {
			this.loader.handleInput(data);
			return;
		}
		if (closeKey(data)) {
			this.host.close();
			return;
		}
		if (matchesKey(data, "c")) this.cancel();
	}

	invalidate(): void {
		this.loader.invalidate();
	}

	render(width: number): string[] {
		return [
			this.host.theme.bold("Source: CancellableLoader"),
			this.host.theme.fg("dim", "Enter start • Esc abort running • Esc again close"),
			...this.loader.render(width),
			this.host.theme.fg("success", `state: ${this.state}`),
		];
	}

	dispose(): void {
		this.clearTimer();
		this.loader.dispose();
	}

	private start(): void {
		this.clearTimer();
		this.state = "running";
		this.timer = setTimeout(() => {
			this.state = "completed";
			this.host.requestRender();
		}, 1_200);
		this.host.requestRender();
	}

	private cancel(): void {
		this.clearTimer();
		this.state = "cancelled";
		this.host.requestRender();
	}

	private clearTimer(): void {
		if (!this.timer) return;
		clearTimeout(this.timer);
		this.timer = undefined;
	}
}

class AutocompleteDemo implements Component {
	private readonly host: DemoHost;
	private readonly editor: Editor;
	private result = "Type after #, then use the real Editor autocomplete popup.";

	constructor(host: DemoHost) {
		this.host = host;
		this.editor = new Editor(host.tui, editorTheme(host.theme), { paddingX: 1 });
		this.editor.setText("Review #");
		this.editor.focused = true;
		this.editor.setAutocompleteProvider(createKitchenSinkAutocompleteProvider());
		this.editor.onChange = () => host.requestRender();
	}

	handleInput(data: string): void {
		if (closeKey(data)) {
			this.host.close();
			return;
		}
		this.editor.handleInput(data);
		this.result = "Editor provider is active for # tokens.";
		this.host.requestRender();
	}

	invalidate(): void {
		this.editor.invalidate();
	}

	render(width: number): string[] {
		return [
			this.host.theme.bold(
				"Source: Editor.setAutocompleteProvider / addAutocompleteProvider style",
			),
			...this.editor.render(width),
			this.host.theme.fg("success", this.result),
		];
	}
}

function createKitchenSinkAutocompleteProvider(): AutocompleteProvider {
	return {
		async getSuggestions(
			lines,
			cursorLine,
			cursorCol,
		): Promise<{ items: AutocompleteItem[]; prefix: string } | null> {
			const current = lines[cursorLine] ?? "";
			const before = current.slice(0, cursorCol);
			const hash = before.lastIndexOf("#");
			if (hash < 0) return null;
			const prefix = before.slice(hash);
			return {
				prefix,
				items: autocompleteSuggestions(prefix).map((item) => ({
					value: item,
					label: item,
					description: "kitchen sink fixture",
				})),
			};
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			const next = [...lines];
			const line = next[cursorLine] ?? "";
			next[cursorLine] = `${line.slice(0, cursorCol - prefix.length)}${item.value}${
				line.slice(cursorCol)
			}`;
			return { lines: next, cursorLine, cursorCol: cursorCol - prefix.length + item.value.length };
		},
	};
}

function createEditorDemo(id: string, host: DemoHost): DemoComponent | undefined {
	if (id === "leader-hint-bar") return new LeaderHintDemo(host);
	if (id === "draft-editor-modal") return new DraftEditorDemo(host);
	if (id === "multi-step-wizard-card") return new WizardDemo(host);
	if (id === "progress-action-card") return new ProgressDemo(host);
	if (id === "autocomplete-suggestion-popup") return new AutocompleteDemo(host);
	return undefined;
}

export { createEditorDemo };
