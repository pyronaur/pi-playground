import {
	defineTool,
	type ExecOptions,
	type ExecResult,
	type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { PiuxLookStore } from "../models/piux-look-store.ts";

const PIUX_SOCKET = "piux";
const PIUX_TARGET = "piux:pi.0";
const PIUX_TOOL_TIMEOUT = 5000;
const DEFAULT_LAST_LINES = 20;

const PIUX_TOOL_NAME = "piux";

type PiuxToolHost = Pick<ExtensionAPI, "exec" | "getActiveTools" | "setActiveTools">;

type PiuxToolOptions = {
	artifactRoot?: string;
	timeout?: number;
};

type PiuxToolParams = {
	action?: string;
	mode?: string;
	lines?: number;
	text?: string;
	keys?: string[];
	enter?: boolean;
};

function toTextResult(text: string, isError = false) {
	return {
		content: [{ type: "text" as const, text }],
		details: {},
		isError,
	};
}

function trimTrailingBlankLines(text: string): string {
	return text.replace(/\s+$/u, "");
}

function toLines(text: string): string[] {
	const lines = text.replace(/\r/g, "").split("\n");
	if (lines.at(-1) === "") {
		lines.pop();
	}

	return lines;
}

function getLastNonEmptyLines(text: string, count: number): string {
	const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
	if (lines.length === 0) {
		return "(no non-empty lines)";
	}

	return lines.slice(-count).join("\n");
}

function formatDiffHeader(startLine: number, length: number): string {
	if (length <= 1) {
		return `@@ line ${startLine}`;
	}

	return `@@ lines ${startLine}-${startLine + length - 1}`;
}

function formatScreenDiff(previous: string, current: string): string | undefined {
	const before = toLines(previous);
	const after = toLines(current);
	const blocks: string[] = [];
	const maxLines = Math.max(before.length, after.length);
	let start = -1;
	let oldLines: string[] = [];
	let newLines: string[] = [];

	function flush() {
		if (start < 0) {
			return;
		}

		blocks.push([
			formatDiffHeader(start + 1, Math.max(oldLines.length, newLines.length)),
			...oldLines.map((line) => `- ${line}`),
			...newLines.map((line) => `+ ${line}`),
		].join("\n"));
		start = -1;
		oldLines = [];
		newLines = [];
	}

	for (let i = 0; i < maxLines; i += 1) {
		const oldLine = before[i] ?? "";
		const newLine = after[i] ?? "";
		if (oldLine === newLine) {
			flush();
			continue;
		}

		if (start < 0) {
			start = i;
		}

		oldLines.push(oldLine);
		newLines.push(newLine);
	}

	flush();
	return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

function getDoSummary(input: {
	text: string | undefined;
	keys: string[];
	enter: boolean;
}): string {
	const parts: string[] = [];
	if (input.text) {
		parts.push("text");
	}
	if ((input.keys?.length ?? 0) > 0) {
		parts.push("keys");
	}
	if (input.enter) {
		parts.push("enter");
	}

	return `sent ${parts.join(", ")}`;
}

export class PiuxTool {
	readonly artifactRoot: string;
	readonly definition;
	readonly #host: PiuxToolHost;
	readonly #timeout: number;
	readonly #store: PiuxLookStore;

	constructor(host: PiuxToolHost, options: PiuxToolOptions = {}) {
		this.#host = host;
		this.#timeout = options.timeout ?? PIUX_TOOL_TIMEOUT;
		this.#store = new PiuxLookStore(options.artifactRoot);
		this.artifactRoot = this.#store.root;
		this.definition = defineTool({
			name: PIUX_TOOL_NAME,
			label: "Piux",
			description: "Inspect and drive the fixed piux tmux session while playground is active.",
			promptSnippet: "Inspect the fixed piux tmux pane with look, or drive it with do.",
			promptGuidelines: [
				"Use `piux` only when playground is active.",
				"Use `look` with default diff for repeated checks, `screen` for a full baseline, and `last` for a compact tail.",
				"Use `do` to send literal text, named tmux keys, and optional Enter to the fixed piux pane.",
			],
			parameters: Type.Object({
				action: Type.String({
					description: "Action to run: `look` or `do`.",
				}),
				mode: Type.Optional(Type.String({
					description: "For `look`: `diff` (default), `screen`, or `last`.",
				})),
				lines: Type.Optional(Type.Integer({
					minimum: 1,
					maximum: 200,
					description: "For `look` mode `last`: number of non-empty lines to return.",
				})),
				text: Type.Optional(Type.String({
					description: "For `do`: literal text to send to the pane.",
				})),
				keys: Type.Optional(Type.Array(Type.String({
					description: "For `do`: tmux key names to send, e.g. `Enter`, `Escape`, `Up`, `C-c`.",
				}), { minItems: 1 })),
				enter: Type.Optional(Type.Boolean({
					description: "For `do`: whether to send Enter after text and keys.",
				})),
			}),
			execute: async (_toolCallId, params, signal) => await this.execute(params, signal),
		});
	}

	syncActive(enabled: boolean): void {
		const activeTools = new Set(this.#host.getActiveTools());
		if (enabled) {
			activeTools.add(PIUX_TOOL_NAME);
			this.#host.setActiveTools([...activeTools]);
			return;
		}

		activeTools.delete(PIUX_TOOL_NAME);
		this.#host.setActiveTools([...activeTools]);
	}

	private async execute(
		params: PiuxToolParams,
		signal: AbortSignal | undefined,
	) {
		try {
			if (params.action === "look") {
				return await this.look(params, signal);
			}

			if (params.action === "do") {
				return await this.do(params, signal);
			}

			return toTextResult("Error: action must be `look` or `do`", true);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return toTextResult(`Error: ${message}`, true);
		}
	}

	private async look(
		params: PiuxToolParams,
		signal: AbortSignal | undefined,
	) {
		const mode = params.mode ?? "diff";
		if (mode === "screen") {
			const screen = await this.captureScreen(signal);
			const path = await this.#store.saveScreen(screen);
			return toTextResult(`Saved ${path}\n\n${trimTrailingBlankLines(screen)}`);
		}

		if (mode === "last") {
			const capture = await this.captureVisible(signal);
			const lines = params.lines ?? DEFAULT_LAST_LINES;
			return toTextResult(getLastNonEmptyLines(capture, lines));
		}

		if (mode !== "diff") {
			return toTextResult("Error: look mode must be `diff`, `screen`, or `last`", true);
		}

		const previous = this.#store.getPreviousScreen();
		const screen = await this.captureScreen(signal);
		const path = await this.#store.saveScreen(screen);
		if (!previous) {
			return toTextResult(`Saved ${path}\n\n${trimTrailingBlankLines(screen)}`);
		}

		const diff = formatScreenDiff(previous, screen);
		if (!diff) {
			return toTextResult(`Saved ${path}\n\nNo visible screen changes.`);
		}

		return toTextResult(`Saved ${path}\n\n${diff}`);
	}

	private async do(
		params: PiuxToolParams,
		signal: AbortSignal | undefined,
	) {
		const text = typeof params.text === "string" && params.text.length > 0
			? params.text
			: undefined;
		const keys = params.keys?.filter((key) => typeof key === "string" && key.length > 0) ?? [];
		const enter = params.enter === true;
		if (!text && keys.length === 0 && !enter) {
			return toTextResult("Error: do needs text, keys, or enter", true);
		}

		if (text) {
			await this.runTmux(["send-keys", "-t", PIUX_TARGET, "-l", "--", text], signal);
		}

		if (keys.length > 0) {
			await this.runTmux(["send-keys", "-t", PIUX_TARGET, ...keys], signal);
		}

		if (enter) {
			await this.runTmux(["send-keys", "-t", PIUX_TARGET, "Enter"], signal);
		}

		return toTextResult(getDoSummary({ text, keys, enter }));
	}

	private async captureVisible(signal: AbortSignal | undefined): Promise<string> {
		const result = await this.runTmux(["capture-pane", "-pt", PIUX_TARGET], signal);
		return result.stdout;
	}

	private async captureScreen(signal: AbortSignal | undefined): Promise<string> {
		const heightResult = await this.runTmux([
			"display-message",
			"-p",
			"-t",
			PIUX_TARGET,
			"#{pane_height}",
		], signal);
		const height = Number.parseInt(heightResult.stdout.trim(), 10);
		if (!Number.isFinite(height) || height <= 0) {
			throw new Error(`Invalid piux pane height: ${heightResult.stdout.trim()}`);
		}

		const result = await this.runTmux([
			"capture-pane",
			"-pt",
			PIUX_TARGET,
			"-S",
			`-${height}`,
		], signal);
		return result.stdout;
	}

	private async runTmux(args: string[], signal: AbortSignal | undefined): Promise<ExecResult> {
		const options: ExecOptions = { timeout: this.#timeout };
		if (signal) {
			options.signal = signal;
		}

		const result = await this.#host.exec("tmux", ["-L", PIUX_SOCKET, ...args], options);
		if (result.code === 0) {
			return result;
		}

		const message = result.stderr.trim() || result.stdout.trim() || `tmux exited ${result.code}`;
		throw new Error(message);
	}
}
