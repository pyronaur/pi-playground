import {
	defineTool,
	type ExecOptions,
	type ExecResult,
	type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import { PpLookStore } from "../models/pp-look-store.ts";

const PP_TOOL_TIMEOUT = 5000;
const DEFAULT_LAST_LINES = 20;
const COLLAPSED_RESULT_LINES = 5;
const DEFAULT_SPLIT_DIRECTION = "right";

const PP_TOOL_NAME = "pp";

type PpToolHost = Pick<ExtensionAPI, "exec" | "getActiveTools" | "setActiveTools">;

type PpToolOptions = {
	artifactRoot?: string;
	originSurfaceId?: string;
	timeout?: number;
};

type PpToolParams = {
	action?: string;
	mode?: string;
	lines?: number;
	text?: string;
	keys?: string[];
	enter?: boolean;
};

type TargetSurface = {
	workspace?: string;
	surface: string;
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

function formatCallArgs(params: PpToolParams): string {
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

function toRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
}

function getString(source: Record<string, unknown>, key: string): string | undefined {
	const value = source[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getStringArray(source: Record<string, unknown>, key: string): string[] {
	const value = source[key];
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
	try {
		return toRecord(JSON.parse(text));
	} catch {
		return undefined;
	}
}

function parseSplitTarget(output: string): TargetSurface {
	const surface = /\bsurface:[^\s]+/u.exec(output)?.[0];
	if (!surface) {
		throw new Error("cmux new-split did not return a surface id");
	}

	const workspace = /\bworkspace:[^\s]+/u.exec(output)?.[0];
	return workspace ? { surface, workspace } : { surface };
}

function isClosedTargetSurfaceError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /\bSurface is not a terminal\b/u.test(message);
}

export class PpTool {
	readonly artifactRoot: string;
	readonly definition;
	readonly #host: PpToolHost;
	readonly #originSurface: string | undefined;
	#targetSurface: TargetSurface | undefined;
	readonly #timeout: number;
	readonly #store: PpLookStore;

	constructor(host: PpToolHost, options: PpToolOptions = {}) {
		this.#host = host;
		this.#originSurface = options.originSurfaceId ?? process.env.CMUX_SURFACE_ID;
		this.#timeout = options.timeout ?? PP_TOOL_TIMEOUT;
		this.#store = new PpLookStore(options.artifactRoot);
		this.artifactRoot = this.#store.root;
		this.definition = defineTool({
			name: PP_TOOL_NAME,
			label: "PP Tool",
			description:
				"Inspect and drive an attached cmux playground pane while Playground Mode is active.",
			promptSnippet: "Use pp to inspect or drive the attached cmux playground pane.",
			promptGuidelines: [
				"Use `pp` only when Playground Mode is active.",
				"The first call creates one cmux split from the origin Pi surface when no playground pane is attached yet.",
				"Use `look diff` for full-output changes, `screen` for the visible viewport, `full_output` for complete cmux scrollback, and `last` for a compact tail.",
				"Use `do` to send literal text, named cmux keys, and optional Enter to the attached playground pane.",
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
					description: "For `do`: literal text to send to the attached playground pane.",
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
				const text = theme.fg("toolTitle", theme.bold("pp "))
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
			activeTools.add(PP_TOOL_NAME);
			this.#host.setActiveTools([...activeTools]);
			return;
		}

		activeTools.delete(PP_TOOL_NAME);
		this.#host.setActiveTools([...activeTools]);
	}

	private async execute(
		params: PpToolParams,
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
		params: PpToolParams,
		signal: AbortSignal | undefined,
	) {
		return await this.withTargetSurface(signal, async (target) => {
			const mode = params.mode ?? "diff";
			const snapshot = await this.captureSnapshot(target, signal);
			const previous = this.#store.getPreviousSnapshot();
			const path = await this.#store.saveSnapshot(snapshot);

			if (mode === "full_output") {
				return toTextResult(`Saved ${path}\n\n${trimTrailingBlankLines(snapshot.fullOutput)}`);
			}

			if (mode === "screen") {
				const screen = await this.captureVisible(target, signal);
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
		});
	}

	private async do(
		params: PpToolParams,
		signal: AbortSignal | undefined,
	) {
		return await this.withTargetSurface(signal, async (target) => {
			const text = typeof params.text === "string" && params.text.length > 0
				? params.text
				: undefined;
			const keys = params.keys?.filter((key) => typeof key === "string" && key.length > 0) ?? [];
			const enter = params.enter === true;
			if (!text && keys.length === 0 && !enter) {
				return toTextResult("Error: do needs text, keys, or enter", true);
			}

			if (text) {
				await this.runCmux([...this.targetArgs("send", target), text], signal);
			}

			if (keys.length > 0) {
				let literal = "";

				const flushLiteral = async () => {
					if (!literal) {
						return;
					}

					await this.runCmux([...this.targetArgs("send", target), literal], signal);
					literal = "";
				};

				for (const key of keys) {
					const cmuxKey = normalizeCmuxKey(key);
					if (!cmuxKey) {
						literal += key;
						continue;
					}

					await flushLiteral();
					await this.runCmux([...this.targetArgs("send-key", target), cmuxKey], signal);
				}

				await flushLiteral();
			}

			if (enter) {
				await this.runCmux([...this.targetArgs("send-key", target), "enter"], signal);
			}

			return toTextResult(getDoSummary({ text, keys, enter }));
		});
	}

	private async captureSnapshot(
		target: TargetSurface,
		signal: AbortSignal | undefined,
	): Promise<{
		fullOutput: string;
		paneHeight: number;
	}> {
		const result = await this.runCmux([
			"read-screen",
			...this.targetFlags(target),
			"--scrollback",
		], signal);
		return {
			fullOutput: result.stdout,
			paneHeight: 0,
		};
	}

	private async captureVisible(
		target: TargetSurface,
		signal: AbortSignal | undefined,
	): Promise<string> {
		const result = await this.runCmux([
			"read-screen",
			...this.targetFlags(target),
		], signal);
		return result.stdout;
	}

	private async resolveTargetSurface(signal: AbortSignal | undefined): Promise<TargetSurface> {
		if (this.#targetSurface) {
			return this.#targetSurface;
		}
		if (!this.#originSurface) {
			throw new Error("CMUX_SURFACE_ID is not set; pp must run from a cmux surface");
		}

		const result = await this.runCmux([
			"new-split",
			DEFAULT_SPLIT_DIRECTION,
			"--surface",
			this.#originSurface,
		], signal);
		const target = parseSplitTarget(result.stdout);
		this.#targetSurface = target;
		return target;
	}

	private async withTargetSurface<T>(
		signal: AbortSignal | undefined,
		operation: (target: TargetSurface) => Promise<T>,
	): Promise<T> {
		const hadTarget = Boolean(this.#targetSurface);
		const target = await this.resolveTargetSurface(signal);
		try {
			return await operation(target);
		} catch (error) {
			if (!hadTarget || !this.#targetSurface || !isClosedTargetSurfaceError(error)) {
				throw error;
			}

			const movedTarget = await this.findTargetSurfaceInWorkspaces(this.#targetSurface, signal);
			if (movedTarget) {
				this.#targetSurface = movedTarget;
				return await operation(movedTarget);
			}

			this.#targetSurface = undefined;
			const replacement = await this.resolveTargetSurface(signal);
			return await operation(replacement);
		}
	}

	private targetFlags(target: TargetSurface): string[] {
		const args: string[] = [];
		if (target.workspace) {
			args.push("--workspace", target.workspace);
		}
		args.push("--surface", target.surface);
		return args;
	}

	private targetArgs(command: "send" | "send-key", target: TargetSurface): string[] {
		return [command, ...this.targetFlags(target)];
	}

	private async findTargetSurfaceInWorkspaces(
		target: TargetSurface,
		signal: AbortSignal | undefined,
	): Promise<TargetSurface | undefined> {
		let workspacesResult: ExecResult;
		try {
			workspacesResult = await this.runCmux([
				"--json",
				"--id-format",
				"both",
				"list-workspaces",
			], signal);
		} catch {
			return undefined;
		}

		const body = parseJsonObject(workspacesResult.stdout);
		const workspacesValue = body?.workspaces;
		const workspaces = Array.isArray(workspacesValue) ? workspacesValue : [];

		for (const item of workspaces) {
			const workspace = toRecord(item);
			if (!workspace) {
				continue;
			}

			const workspaceArg = getString(workspace, "ref")
				?? getString(workspace, "workspace_ref")
				?? getString(workspace, "id")
				?? getString(workspace, "workspace_id");
			if (!workspaceArg) {
				continue;
			}

			const found = await this.findTargetSurfaceInWorkspace(target, workspaceArg, signal);
			if (found) {
				return found;
			}
		}

		return undefined;
	}

	private async findTargetSurfaceInWorkspace(
		target: TargetSurface,
		workspaceArg: string,
		signal: AbortSignal | undefined,
	): Promise<TargetSurface | undefined> {
		let panesResult: ExecResult;
		try {
			panesResult = await this.runCmux([
				"--json",
				"--id-format",
				"both",
				"list-panes",
				"--workspace",
				workspaceArg,
			], signal);
		} catch {
			return undefined;
		}

		const body = parseJsonObject(panesResult.stdout);
		if (!body) {
			return undefined;
		}

		const workspace = getString(body, "workspace_id")
			?? getString(body, "workspace_ref")
			?? workspaceArg;
		const panes = Array.isArray(body.panes) ? body.panes : [];

		for (const item of panes) {
			const pane = toRecord(item);
			if (!pane) {
				continue;
			}

			const refs = getStringArray(pane, "surface_refs");
			const ids = getStringArray(pane, "surface_ids");
			const refIndex = refs.indexOf(target.surface);
			const idIndex = ids.indexOf(target.surface);
			const matchIndex = refIndex >= 0 ? refIndex : idIndex;
			if (matchIndex < 0) {
				continue;
			}

			return {
				workspace,
				surface: ids[matchIndex] ?? refs[matchIndex] ?? target.surface,
			};
		}

		return undefined;
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
