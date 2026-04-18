import {
	defineTool,
	type ExecOptions,
	type ExecResult,
	type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import { PiuxLookStore } from "../models/piux-look-store.ts";

const PIUX_WORKSPACE_TITLE = "piux";
const PIUX_TOOL_TIMEOUT = 5000;
const DEFAULT_LAST_LINES = 20;
const COLLAPSED_RESULT_LINES = 5;

const PIUX_TOOL_NAME = "piux_client";

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

type PiuxWorkspace = {
	id: string;
	ref: string;
	title: string;
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

function getLastLines(text: string, count: number): string {
	const lines = toLines(text);
	if (lines.length === 0) {
		return "";
	}

	return lines.slice(-count).join("\n");
}

function isSeparatorLine(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed.length < 10) {
		return false;
	}

	return /^[-─]+$/u.test(trimmed);
}

function isTransientStatusLine(line: string): boolean {
	return /\b(Working|Thinking)\.\.\.$/u.test(line.trim());
}

function getLastNonEmptyLineIndex(lines: string[]): number {
	for (let i = lines.length - 1; i >= 0; i -= 1) {
		if ((lines[i] ?? "").trim().length > 0) {
			return i;
		}
	}

	return -1;
}

function hasFooterAfterSeparator(
	lines: string[],
	separatorIndex: number,
	lastNonEmpty: number,
): boolean {
	const visibleFooter = lines.slice(separatorIndex + 1,
		Math.min(lastNonEmpty + 1, separatorIndex + 9));
	const meaningful = visibleFooter.filter((line) =>
		line.trim().length > 0 && !isSeparatorLine(line)
	);
	if (meaningful.length < 2) {
		return false;
	}

	return meaningful[0]?.startsWith("/") === true;
}

function stripInputArea(text: string, _paneHeight: number): string {
	const lines = toLines(text);
	if (lines.length === 0) {
		return "";
	}
	const lastNonEmpty = getLastNonEmptyLineIndex(lines);
	if (lastNonEmpty < 0) {
		return "";
	}
	const searchStart = Math.max(0, lastNonEmpty - 8);

	let footerStart = -1;
	for (let i = lastNonEmpty; i >= searchStart; i -= 1) {
		if (!isSeparatorLine(lines[i] ?? "")) {
			continue;
		}
		if (!hasFooterAfterSeparator(lines, i, lastNonEmpty)) {
			continue;
		}

		footerStart = i;
		for (let j = i - 1; j >= 0; j -= 1) {
			const line = lines[j] ?? "";
			if (line.trim().length > 0 && !isSeparatorLine(line)) {
				break;
			}

			if (isSeparatorLine(line)) {
				footerStart = j;
			}
		}
		break;
	}

	if (footerStart < 0) {
		return trimTrailingBlankLines(text);
	}

	let start = footerStart;
	for (let i = footerStart - 1; i >= 0; i -= 1) {
		const line = lines[i] ?? "";
		if (line.trim().length === 0) {
			continue;
		}

		if (isTransientStatusLine(line)) {
			start = i;
		}
		break;
	}

	return lines.slice(0, start).join("\n");
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

function formatCallArgs(params: PiuxToolParams): string {
	if (params.action === "look") {
		const parts = [`action=${params.action}`, `mode=${params.mode ?? "diff"}`];
		if (typeof params.lines === "number") {
			parts.push(`lines=${params.lines}`);
		}
		return parts.join(" ");
	}

	if (params.action === "do") {
		const parts = [`action=${params.action}`];
		if (typeof params.text === "string") {
			parts.push(`text=${JSON.stringify(params.text)}`);
		}
		if (params.keys && params.keys.length > 0) {
			parts.push(`keys=${JSON.stringify(params.keys)}`);
		}
		if (typeof params.enter === "boolean") {
			parts.push(`enter=${params.enter}`);
		}
		return parts.join(" ");
	}

	return `action=${params.action ?? "unknown"}`;
}

function normalizeCmuxKey(key: string): string | undefined {
	switch (key.trim().toLowerCase()) {
		case "enter":
		case "return":
			return "enter";
		case "tab":
			return "tab";
		case "escape":
		case "esc":
			return "escape";
		case "backspace":
			return "backspace";
		case "delete":
		case "del":
		case "forward_delete":
			return "delete";
		case "up":
		case "arrow_up":
		case "arrowup":
			return "up";
		case "down":
		case "arrow_down":
		case "arrowdown":
			return "down";
		case "left":
		case "arrow_left":
		case "arrowleft":
			return "left";
		case "right":
		case "arrow_right":
		case "arrowright":
			return "right";
		case "ctrl-c":
		case "ctrl+c":
		case "sigint":
			return "ctrl-c";
		case "ctrl-d":
		case "ctrl+d":
		case "eof":
			return "ctrl-d";
		case "ctrl-z":
		case "ctrl+z":
		case "sigtstp":
			return "ctrl-z";
		case "ctrl-\\":
		case "ctrl+\\":
		case "sigquit":
			return "ctrl-\\";
		case "home":
			return "home";
		case "end":
			return "end";
		case "pageup":
		case "page_up":
			return "page_up";
		case "pagedown":
		case "page_down":
			return "page_down";
		case "shift+tab":
		case "shift-tab":
		case "backtab":
			return undefined;
		default:
			return undefined;
	}
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
			label: "Piux Client",
			description: "Inspect and drive the fixed piux cmux workspace while playground is active.",
			promptSnippet: "Inspect the fixed piux cmux workspace with look, or drive it with do.",
			promptGuidelines: [
				"Use `piux_client` only when playground is active.",
				"Use `look diff` for full-output changes, `screen` for the visible viewport, `full_output` for complete cmux scrollback, and `last` for a compact tail.",
				"Use `do` to send literal text, named cmux keys, and optional Enter to the fixed piux workspace.",
			],
			parameters: Type.Object({
				action: Type.String({
					description: "Action to run: `look` or `do`.",
				}),
				mode: Type.Optional(Type.String({
					description: "For `look`: `diff` (default), `screen`, `full_output`, or `last`.",
				})),
				lines: Type.Optional(Type.Integer({
					minimum: 1,
					maximum: 200,
					description: "For `look` mode `last`: number of non-empty lines to return.",
				})),
				text: Type.Optional(Type.String({
					description: "For `do`: literal text to send to the workspace's selected terminal.",
				})),
				keys: Type.Optional(Type.Array(Type.String({
					description:
						"For `do`: key names or literal key fragments to send, e.g. `Enter`, `Escape`, `Up`, `ctrl-c`, `[`, `Z`.",
				}), { minItems: 1 })),
				enter: Type.Optional(Type.Boolean({
					description: "For `do`: whether to send Enter after text and keys.",
				})),
			}),
			execute: async (_toolCallId, params, signal) => await this.execute(params, signal),
			renderCall(args, theme) {
				const text = theme.fg("toolTitle", theme.bold("piux_client "))
					+ theme.fg("muted", formatCallArgs(args));
				return new Text(text, 0, 0);
			},
			renderResult(result, { expanded }, theme) {
				const textContent = result.content.find((item) => item.type === "text");
				if (!textContent || textContent.type !== "text") {
					return new Text("", 0, 0);
				}

				const text = expanded
					? trimTrailingBlankLines(textContent.text)
					: getLastLines(textContent.text, COLLAPSED_RESULT_LINES);
				if (!text) {
					return new Text("", 0, 0);
				}

				const output = text.split("\n").map((line) => theme.fg("toolOutput", line)).join("\n");
				return new Text(output, 0, 0);
			},
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
		const workspace = await this.resolveWorkspace(signal);
		const snapshot = await this.captureSnapshot(workspace, signal);
		const previous = this.#store.getPreviousSnapshot();
		const path = await this.#store.saveSnapshot(snapshot);

		if (mode === "full_output") {
			return toTextResult(`Saved ${path}\n\n${trimTrailingBlankLines(snapshot.fullOutput)}`);
		}

		if (mode === "screen") {
			const screen = await this.captureVisible(workspace, signal);
			return toTextResult(`Saved ${path}\n\n${trimTrailingBlankLines(screen)}`);
		}

		if (mode === "last") {
			const lines = params.lines ?? DEFAULT_LAST_LINES;
			return toTextResult(getLastNonEmptyLines(snapshot.fullOutput, lines));
		}

		if (mode !== "diff") {
			return toTextResult(
				"Error: look mode must be `diff`, `screen`, `full_output`, or `last`",
				true,
			);
		}

		if (!previous) {
			return toTextResult(`Saved ${path}\n\n${trimTrailingBlankLines(snapshot.fullOutput)}`);
		}

		const diff = formatScreenDiff(
			stripInputArea(previous.fullOutput, previous.paneHeight),
			stripInputArea(snapshot.fullOutput, snapshot.paneHeight),
		);
		if (!diff) {
			return toTextResult(`Saved ${path}\n\nNo output changes.`);
		}

		return toTextResult(`Saved ${path}\n\n${diff}`);
	}

	private async do(
		params: PiuxToolParams,
		signal: AbortSignal | undefined,
	) {
		const workspace = await this.resolveWorkspace(signal);
		const text = typeof params.text === "string" && params.text.length > 0
			? params.text
			: undefined;
		const keys = params.keys?.filter((key) => typeof key === "string" && key.length > 0) ?? [];
		const enter = params.enter === true;
		if (!text && keys.length === 0 && !enter) {
			return toTextResult("Error: do needs text, keys, or enter", true);
		}

		if (text) {
			await this.runCmux(["send", "--workspace", workspace.ref, text], signal);
		}

		if (keys.length > 0) {
			let literal = "";

			const flushLiteral = async () => {
				if (!literal) {
					return;
				}

				await this.runCmux(["send", "--workspace", workspace.ref, literal], signal);
				literal = "";
			};

			for (const key of keys) {
				const cmuxKey = normalizeCmuxKey(key);
				if (!cmuxKey) {
					literal += key;
					continue;
				}

				await flushLiteral();
				await this.runCmux(["send-key", "--workspace", workspace.ref, cmuxKey], signal);
			}

			await flushLiteral();
		}

		if (enter) {
			await this.runCmux(["send-key", "--workspace", workspace.ref, "enter"], signal);
		}

		return toTextResult(getDoSummary({ text, keys, enter }));
	}

	private async captureSnapshot(
		workspace: PiuxWorkspace,
		signal: AbortSignal | undefined,
	): Promise<{
		fullOutput: string;
		paneHeight: number;
	}> {
		const result = await this.runCmux([
			"read-screen",
			"--workspace",
			workspace.ref,
			"--scrollback",
		], signal);
		return {
			fullOutput: result.stdout,
			paneHeight: 0,
		};
	}

	private async captureVisible(
		workspace: PiuxWorkspace,
		signal: AbortSignal | undefined,
	): Promise<string> {
		const result = await this.runCmux([
			"read-screen",
			"--workspace",
			workspace.ref,
		], signal);
		return result.stdout;
	}

	private async resolveWorkspace(signal: AbortSignal | undefined): Promise<PiuxWorkspace> {
		const result = await this.runCmux(["rpc", "workspace.list", "{}"], signal);

		let payload: unknown;
		try {
			payload = JSON.parse(result.stdout);
		} catch {
			throw new Error("cmux returned invalid JSON for workspace.list");
		}

		const workspaces = Array.isArray((payload as { workspaces?: unknown }).workspaces)
			? (payload as { workspaces: Array<Record<string, unknown>> }).workspaces
			: [];
		const matches = workspaces
			.map((workspace) => ({
				id: typeof workspace.id === "string" ? workspace.id : "",
				ref: typeof workspace.ref === "string" ? workspace.ref : "",
				title: typeof workspace.title === "string" ? workspace.title : "",
			}))
			.filter((workspace) => workspace.title === PIUX_WORKSPACE_TITLE);

		const match = matches[0];
		if (matches.length === 1 && match) {
			return match;
		}

		if (matches.length > 1) {
			throw new Error("Multiple cmux workspaces are titled `piux`");
		}

		throw new Error("cmux workspace `piux` not found");
	}

	private async runCmux(args: string[], signal: AbortSignal | undefined): Promise<ExecResult> {
		const options: ExecOptions = { timeout: this.#timeout };
		if (signal) {
			options.signal = signal;
		}

		const result = await this.#host.exec("cmux", args, options);
		if (result.code === 0) {
			return result;
		}

		const message = result.stderr.trim() || result.stdout.trim() || `cmux exited ${result.code}`;
		throw new Error(message);
	}
}
