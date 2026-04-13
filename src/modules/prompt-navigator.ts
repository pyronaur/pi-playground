import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";

import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@mariozechner/pi-coding-agent";
import {
	type Focusable,
	Key,
	matchesKey,
	truncateToWidth,
	type TUI,
	visibleWidth,
} from "@mariozechner/pi-tui";

import { getEditorPaddingX } from "./editor-padding.ts";

type NavigatorTab = "session" | "system" | "tools";

const NAVIGATOR_TABS: NavigatorTab[] = ["session", "system", "tools"];

type PromptNavigatorItem = {
	id: string;
	label: string;
	title: string;
	content: string;
	path?: string;
	kind: "file" | "synthetic" | "tool";
	meta?: string;
};

type PromptNavigatorData = {
	sessionItems: PromptNavigatorItem[];
	systemItems: PromptNavigatorItem[];
	toolItems: PromptNavigatorItem[];
	activeToolCount: number;
	totalToolCount: number;
	fullPrompt: string;
	currentDirectory: string;
};

type NavigatorCtx = Pick<
	ExtensionContext,
	"cwd" | "getSystemPrompt" | "hasUI" | "sessionManager" | "ui"
>;

type PromptNavigatorOptions = {
	agentDir?: string;
	activeToolNames?: string[];
	allTools?: ToolInfo[];
	sessionData?: PromptSessionData;
};

type PromptSessionHeader = {
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
	version?: number;
};

type PromptSessionEntry = {
	type: string;
	id: string;
	parentId: string | null;
	timestamp?: string;
	provider?: unknown;
	modelId?: unknown;
	thinkingLevel?: unknown;
};

type PromptSessionData = {
	sessionFile?: string;
	sessionDir?: string;
	sessionId?: string;
	sessionName?: string;
	leafId?: string | null;
	header?: PromptSessionHeader | null;
	entries?: PromptSessionEntry[];
	branch?: PromptSessionEntry[];
	rawFile?: string;
};

const CONFIG_DIR = ".pi";
const MAX_LIST_LINES = 16;
const MAX_BODY_LINES = 24;

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function getAgentDir(): string {
	const envDir = process.env.PI_CODING_AGENT_DIR;
	if (envDir) {
		return expandHome(envDir);
	}

	return join(homedir(), CONFIG_DIR, "agent");
}

function readIfExists(path: string | undefined): string | undefined {
	if (!path || !existsSync(path)) {
		return undefined;
	}

	return readFileSync(path, "utf8");
}

function shortPath(path: string, cwd: string): string {
	const home = homedir();
	if (path === cwd) return ".";
	if (path === home) return "~";
	if (path.startsWith(`${cwd}${sep}`)) {
		return relative(cwd, path) || ".";
	}
	if (path.startsWith(`${home}${sep}`)) {
		return `~/${relative(home, path)}`;
	}

	return path;
}

function shortHomePath(path: string): string {
	const home = homedir();
	if (path === home) {
		return "~";
	}
	if (path.startsWith(`${home}${sep}`)) {
		return `~/${relative(home, path)}`;
	}

	return path;
}

export function getPromptNavigatorLayout(width: number, editorPaddingX: number): {
	rowWidth: number;
	innerWidth: number;
	listWidth: number;
	bodyWidth: number;
	contentPadding: number;
} {
	const rowWidth = Math.max(20, width);
	const innerWidth = Math.max(1, rowWidth - 2);
	const contentPadding = Math.max(1, Math.min(3, Math.floor(editorPaddingX)));
	const listWidth = Math.min(32 + contentPadding,
		Math.max(22 + contentPadding, Math.floor(innerWidth * 0.28)));
	const bodyWidth = Math.max(20, rowWidth - listWidth - 3);
	return { rowWidth, innerWidth, listWidth, bodyWidth, contentPadding };
}

function getVisibleWindow(total: number, selected: number, limit: number): [number, number] {
	if (total <= limit) {
		return [0, total];
	}

	const half = Math.floor(limit / 2);
	let start = Math.max(0, selected - half);
	let end = Math.min(total, start + limit);
	start = Math.max(0, end - limit);
	return [start, end];
}

function wrapLine(text: string, width: number): string[] {
	if (width <= 1) {
		return [text];
	}
	if (text.length === 0) {
		return [""];
	}

	const lines: string[] = [];
	let remaining = text;
	while (remaining.length > width) {
		lines.push(remaining.slice(0, width));
		remaining = remaining.slice(width);
	}
	lines.push(remaining);
	return lines;
}

function wrapText(text: string, width: number): string[] {
	return text.split("\n").flatMap((line) => wrapLine(line, width));
}

function discoverSystemPromptPath(cwd: string, agentDir: string): string | undefined {
	const projectPath = join(cwd, CONFIG_DIR, "SYSTEM.md");
	if (existsSync(projectPath)) {
		return projectPath;
	}

	const globalPath = join(agentDir, "SYSTEM.md");
	if (existsSync(globalPath)) {
		return globalPath;
	}

	return undefined;
}

function discoverAppendSystemPromptPath(cwd: string, agentDir: string): string | undefined {
	const projectPath = join(cwd, CONFIG_DIR, "APPEND_SYSTEM.md");
	if (existsSync(projectPath)) {
		return projectPath;
	}

	const globalPath = join(agentDir, "APPEND_SYSTEM.md");
	if (existsSync(globalPath)) {
		return globalPath;
	}

	return undefined;
}

function discoverContextFile(dir: string): string | undefined {
	for (const name of ["AGENTS.md", "CLAUDE.md"]) {
		const path = join(dir, name);
		if (existsSync(path)) {
			return path;
		}
	}

	return undefined;
}

function discoverContextPaths(cwd: string, agentDir: string): string[] {
	const files: string[] = [];
	const seen = new Set<string>();
	const globalFile = discoverContextFile(agentDir);
	if (globalFile) {
		files.push(globalFile);
		seen.add(resolve(globalFile));
	}

	const ancestors: string[] = [];
	let current = resolve(cwd);
	const root = resolve(sep);
	while (true) {
		const file = discoverContextFile(current);
		if (file) {
			const key = resolve(file);
			if (!seen.has(key)) {
				ancestors.unshift(file);
				seen.add(key);
			}
		}
		if (current === root) {
			break;
		}
		const parent = resolve(current, "..");
		if (parent === current) {
			break;
		}
		current = parent;
	}

	files.push(...ancestors);
	return files;
}

function extractFooter(fullPrompt: string): string | undefined {
	const match = fullPrompt.match(/\nCurrent date: .*\nCurrent working directory: .*$/s);
	if (!match) {
		return undefined;
	}

	return match[0].trimStart();
}

function stripFooter(fullPrompt: string): string {
	const footer = extractFooter(fullPrompt);
	if (!footer) {
		return fullPrompt;
	}

	return fullPrompt.slice(0, fullPrompt.length - footer.length).trimEnd();
}

function extractSkillsBlock(promptWithoutFooter: string): string | undefined {
	const start = promptWithoutFooter.indexOf(
		"The following skills provide specialized instructions for specific tasks.",
	);
	const endMarker = "</available_skills>";
	const end = promptWithoutFooter.indexOf(endMarker);
	if (start < 0 || end < start) {
		return undefined;
	}

	return promptWithoutFooter.slice(start, end + endMarker.length).trim();
}

function stripSkillsBlock(promptWithoutFooter: string): string {
	const skills = extractSkillsBlock(promptWithoutFooter);
	if (!skills) {
		return promptWithoutFooter;
	}

	return promptWithoutFooter.replace(skills, "").trimEnd();
}

function extractPrelude(fullPrompt: string): string {
	const withoutFooter = stripFooter(fullPrompt);
	const withoutSkills = stripSkillsBlock(withoutFooter);
	const projectIndex = withoutSkills.indexOf("\n\n# Project Context\n\n");
	if (projectIndex >= 0) {
		return withoutSkills.slice(0, projectIndex).trimEnd();
	}

	return withoutSkills.trimEnd();
}

function formatToolContent(tool: ToolInfo): string {
	const parts = [
		`Name: ${tool.name}`,
		`Description: ${tool.description ?? "(no description)"}`,
	];
	if (tool.sourceInfo?.path) {
		parts.push(`Source: ${tool.sourceInfo.path}`);
	}
	parts.push("", "Parameters:", JSON.stringify(tool.parameters ?? {}, null, 2));
	return parts.join("\n");
}

function findLatestEntry(
	entries: PromptSessionEntry[] | undefined,
	type: string,
): PromptSessionEntry | undefined {
	if (!entries) {
		return undefined;
	}

	for (let index = entries.length - 1; index >= 0; index -= 1) {
		if (entries[index]?.type === type) {
			return entries[index];
		}
	}

	return undefined;
}

function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function formatSessionState(session: PromptSessionData, cwd: string): string {
	const model = findLatestEntry(session.branch, "model_change");
	const thinking = findLatestEntry(session.branch, "thinking_level_change");
	const compaction = findLatestEntry(session.branch, "compaction");
	const parts = [
		`Session ID: ${session.sessionId ?? session.header?.id ?? "(unknown)"}`,
		`Session file: ${session.sessionFile ?? "(not persisted)"}`,
		`Session dir: ${session.sessionDir ?? "(unknown)"}`,
		`Session name: ${session.sessionName ?? "(none)"}`,
		`Leaf ID: ${session.leafId ?? "(none)"}`,
		`Header cwd: ${session.header?.cwd ?? cwd}`,
		`Current cwd: ${cwd}`,
		`Entry count: ${session.entries?.length ?? 0}`,
		`Branch entry count: ${session.branch?.length ?? 0}`,
		`Current model: ${
			model ? `${String(model.provider ?? "?")}/${String(model.modelId ?? "?")}` : "(none)"
		}`,
		`Thinking level: ${thinking ? String(thinking.thinkingLevel ?? "?") : "(none)"}`,
		`Latest compaction: ${compaction ? String(compaction.id) : "(none)"}`,
	];

	if (session.header) {
		parts.push("", "Header:", formatJson(session.header));
	}

	return parts.join("\n");
}

function createSessionItems(
	cwd: string,
	session: PromptSessionData | undefined,
): PromptNavigatorItem[] {
	if (!session) {
		return [{
			id: "session-state",
			label: "session state",
			title: "Current session state",
			content: "Session data unavailable.",
			kind: "synthetic",
		}];
	}

	const items: PromptNavigatorItem[] = [];
	const rawFile = session.rawFile ?? readIfExists(session.sessionFile);
	if (rawFile !== undefined) {
		const rawItem: PromptNavigatorItem = {
			id: "session-jsonl",
			label: "session jsonl",
			title: "Current session JSONL",
			content: rawFile,
			kind: session.sessionFile ? "file" : "synthetic",
			meta: session.sessionFile ? shortPath(session.sessionFile, cwd) : "not persisted",
		};
		if (session.sessionFile) {
			rawItem.path = session.sessionFile;
		}
		items.push(rawItem);
	}

	if (session.branch && session.branch.length > 0) {
		items.push({
			id: "session-branch",
			label: "current branch",
			title: "Current branch entries",
			content: formatJson(session.branch),
			kind: "synthetic",
			meta: `${session.branch.length} entries`,
		});
	}

	items.push({
		id: "session-state",
		label: "session state",
		title: "Current session state",
		content: formatSessionState(session, cwd),
		kind: "synthetic",
		meta: session.sessionFile ? shortPath(session.sessionFile, cwd) : "not persisted",
	});

	return items;
}

export function createPromptNavigatorData(
	ctx: Pick<NavigatorCtx, "cwd" | "getSystemPrompt">,
	options: PromptNavigatorOptions = {},
): PromptNavigatorData {
	const agentDir = options.agentDir ?? getAgentDir();
	const fullPrompt = ctx.getSystemPrompt();
	const sessionItems = createSessionItems(ctx.cwd, options.sessionData);
	const systemItems: PromptNavigatorItem[] = [
		{
			id: "effective-system-prompt",
			label: "full prompt",
			title: "Full effective system prompt",
			content: fullPrompt,
			kind: "synthetic",
			meta: `${fullPrompt.length} chars • exact runtime prompt`,
		},
	];

	const systemPath = discoverSystemPromptPath(ctx.cwd, agentDir);
	const systemContent = readIfExists(systemPath);
	const appendPath = discoverAppendSystemPromptPath(ctx.cwd, agentDir);
	const appendContent = readIfExists(appendPath);
	const prelude = extractPrelude(fullPrompt);

	if (systemPath && systemContent !== undefined) {
		systemItems.push({
			id: `file:${systemPath}`,
			label: shortPath(systemPath, ctx.cwd),
			title: basename(systemPath),
			content: systemContent,
			path: systemPath,
			kind: "file",
		});
	} else if (prelude.length > 0) {
		let builtInBase = prelude;
		if (appendContent) {
			const suffix = `\n\n${appendContent}`;
			if (builtInBase.endsWith(suffix)) {
				builtInBase = builtInBase.slice(0, -suffix.length).trimEnd();
			}
		}

		if (builtInBase.length > 0) {
			systemItems.push({
				id: "built-in-base",
				label: "built-in base",
				title: "Pi built-in base prompt",
				content: builtInBase,
				kind: "synthetic",
			});
		}
	}

	if (appendPath && appendContent !== undefined) {
		systemItems.push({
			id: `file:${appendPath}`,
			label: shortPath(appendPath, ctx.cwd),
			title: basename(appendPath),
			content: appendContent,
			path: appendPath,
			kind: "file",
		});
	}

	for (const path of discoverContextPaths(ctx.cwd, agentDir)) {
		const content = readIfExists(path);
		if (content === undefined) {
			continue;
		}

		systemItems.push({
			id: `file:${path}`,
			label: shortPath(path, ctx.cwd),
			title: basename(path),
			content,
			path,
			kind: "file",
		});
	}

	const skillsBlock = extractSkillsBlock(stripFooter(fullPrompt));
	if (skillsBlock) {
		systemItems.push({
			id: "skills-block",
			label: "skills",
			title: "Skills prompt block",
			content: skillsBlock,
			kind: "synthetic",
		});
	}

	const footer = extractFooter(fullPrompt);
	if (footer) {
		systemItems.push({
			id: "runtime-footer",
			label: "runtime",
			title: "Runtime footer",
			content: footer,
			kind: "synthetic",
		});
	}

	const activeToolNames = options.activeToolNames ?? [];
	const activeToolSet = new Set(activeToolNames);
	const allTools = options.allTools ?? [];
	const activeTools = allTools.filter((tool) => activeToolSet.has(tool.name));
	activeTools.sort((left, right) =>
		activeToolNames.indexOf(left.name) - activeToolNames.indexOf(right.name)
	);

	const toolItems = activeTools.map((tool) => ({
		id: `tool:${tool.name}`,
		label: tool.name,
		title: tool.name,
		content: formatToolContent(tool),
		path: tool.sourceInfo?.path,
		kind: "tool" as const,
		meta: tool.description,
	}));

	return {
		sessionItems,
		systemItems,
		toolItems,
		activeToolCount: toolItems.length,
		totalToolCount: allTools.length,
		fullPrompt,
		currentDirectory: ctx.cwd,
	};
}

function getEditorCommand(): { command: string; args: string[] } | undefined {
	const editorCmd = process.env.VISUAL || process.env.EDITOR;
	if (!editorCmd) {
		return undefined;
	}

	const [command, ...args] = editorCmd.split(" ").filter(Boolean);
	if (!command) {
		return undefined;
	}

	return { command, args };
}

function slugifyTitle(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);

	return slug || "system-view";
}

export function writePromptNavigatorTextFile(
	content: string,
	title: string,
	root = join(tmpdir(), "pi-system"),
	stamp = String(Date.now()),
): string {
	mkdirSync(root, { recursive: true });
	const path = join(root, `${slugifyTitle(title)}-${stamp}.md`);
	writeFileSync(path, content, "utf8");
	return path;
}

export function getExternalEditorCommandForTest(
	env: NodeJS.ProcessEnv,
): { command: string; args: string[] } | undefined {
	const editorCmd = env.VISUAL || env.EDITOR;
	if (!editorCmd) {
		return undefined;
	}

	const [command, ...args] = editorCmd.split(" ").filter(Boolean);
	if (!command) {
		return undefined;
	}

	return { command, args };
}

class PromptNavigatorComponent implements Focusable {
	focused = false;
	private tab: NavigatorTab = "session";
	private sessionIndex = 0;
	private systemIndex = 0;
	private toolIndex = 0;
	private scroll = 0;
	private busy = false;
	private tui: TUI;
	private theme: ExtensionContext["ui"]["theme"];
	private data: PromptNavigatorData;
	private done: () => void;
	private onCopyText: (item: PromptNavigatorItem) => Promise<void>;
	private onOpenSource: (path: string) => Promise<void>;
	private onOpenText: (item: PromptNavigatorItem) => Promise<void>;
	private onEditSource: (path: string) => Promise<void>;
	private contentPadding: number;

	constructor(
		tui: TUI,
		theme: ExtensionContext["ui"]["theme"],
		data: PromptNavigatorData,
		done: () => void,
		onCopyText: (item: PromptNavigatorItem) => Promise<void>,
		onOpenSource: (path: string) => Promise<void>,
		onOpenText: (item: PromptNavigatorItem) => Promise<void>,
		onEditSource: (path: string) => Promise<void>,
		contentPadding: number,
	) {
		this.tui = tui;
		this.theme = theme;
		this.data = data;
		this.done = done;
		this.onCopyText = onCopyText;
		this.onOpenSource = onOpenSource;
		this.onOpenText = onOpenText;
		this.onEditSource = onEditSource;
		this.contentPadding = contentPadding;
	}

	private get items(): PromptNavigatorItem[] {
		if (this.tab === "session") {
			return this.data.sessionItems;
		}

		if (this.tab === "system") {
			return this.data.systemItems;
		}

		return this.data.toolItems;
	}

	private get selectedIndex(): number {
		if (this.tab === "session") {
			return this.sessionIndex;
		}

		if (this.tab === "system") {
			return this.systemIndex;
		}

		return this.toolIndex;
	}

	private set selectedIndex(value: number) {
		if (this.tab === "session") {
			this.sessionIndex = value;
			return;
		}

		if (this.tab === "system") {
			this.systemIndex = value;
			return;
		}

		this.toolIndex = value;
	}

	private get selectedItem(): PromptNavigatorItem | undefined {
		return this.items[this.selectedIndex];
	}

	private setTab(tab: NavigatorTab): void {
		if (this.tab === tab) {
			return;
		}

		this.tab = tab;
		this.scroll = 0;
		this.tui.requestRender();
	}

	private moveTab(delta: number): void {
		const current = NAVIGATOR_TABS.indexOf(this.tab);
		const next = Math.max(0, Math.min(NAVIGATOR_TABS.length - 1, current + delta));
		const tab = NAVIGATOR_TABS[next];
		if (!tab) {
			return;
		}

		this.setTab(tab);
	}

	private moveSelection(delta: number): void {
		if (this.items.length === 0) {
			return;
		}

		const next = Math.max(0, Math.min(this.items.length - 1, this.selectedIndex + delta));
		if (next === this.selectedIndex) {
			return;
		}

		this.selectedIndex = next;
		this.scroll = 0;
		this.tui.requestRender();
	}

	private scrollBody(delta: number): void {
		const item = this.selectedItem;
		if (!item) {
			return;
		}

		const bodyWidth = 56;
		const totalLines = wrapText(item.content, bodyWidth).length;
		const maxScroll = Math.max(0, totalLines - MAX_BODY_LINES);
		const next = Math.max(0, Math.min(maxScroll, this.scroll + delta));
		if (next === this.scroll) {
			return;
		}

		this.scroll = next;
		this.tui.requestRender();
	}

	private runPathAction(action: (path: string) => Promise<void>): void {
		const path = this.selectedItem?.path;
		if (!path || this.busy) {
			return;
		}

		this.busy = true;
		void action(path).finally(() => {
			this.busy = false;
			this.tui.requestRender();
		});
	}

	private runItemAction(action: (item: PromptNavigatorItem) => Promise<void>): void {
		const item = this.selectedItem;
		if (!item || this.busy) {
			return;
		}

		this.busy = true;
		void action(item).finally(() => {
			this.busy = false;
			this.tui.requestRender();
		});
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
			this.done();
			return;
		}

		if (matchesKey(data, "left")) {
			this.moveTab(-1);
			return;
		}

		if (matchesKey(data, "right")) {
			this.moveTab(1);
			return;
		}

		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.moveSelection(-1);
			return;
		}

		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.moveSelection(1);
			return;
		}

		if (matchesKey(data, Key.pageUp)) {
			this.scrollBody(-10);
			return;
		}

		if (matchesKey(data, Key.pageDown) || matchesKey(data, "space")) {
			this.scrollBody(10);
			return;
		}

		if (matchesKey(data, "home")) {
			this.scroll = 0;
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "end")) {
			this.scroll = 9_999_999;
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "c")) {
			this.runItemAction(this.onCopyText);
			return;
		}

		if (matchesKey(data, "o")) {
			this.runPathAction(this.onOpenSource);
			return;
		}

		if (matchesKey(data, "e")) {
			this.runItemAction(this.onOpenText);
			return;
		}

		if (matchesKey(data, "s")) {
			this.runPathAction(this.onEditSource);
		}
	}

	render(width: number): string[] {
		const theme = this.theme;
		const { innerWidth, listWidth, bodyWidth, contentPadding } = getPromptNavigatorLayout(
			width,
			this.contentPadding,
		);
		const border = (value: string) => theme.fg("border", value);
		const inset = " ".repeat(contentPadding);
		const listContentWidth = Math.max(1, listWidth - contentPadding);
		const bodyContentWidth = Math.max(1, bodyWidth - contentPadding);
		const pad = (value: string, target: number) => {
			const visual = visibleWidth(value);
			return value + " ".repeat(Math.max(0, target - visual));
		};
		const row = (left: string, right: string) =>
			border("│")
			+ pad(truncateToWidth(left, listWidth, "…", true), listWidth)
			+ border("│")
			+ pad(truncateToWidth(right, bodyWidth, "…", true), bodyWidth)
			+ border("│");

		const tabs = [
			this.tab === "session"
				? theme.bold(theme.fg("accent", "[Session]"))
				: theme.fg("dim", "[Session]"),
			this.tab === "system"
				? theme.bold(theme.fg("accent", "[System Prompt]"))
				: theme.fg("dim", "[System Prompt]"),
			this.tab === "tools" ? theme.bold(theme.fg("accent", "[Tools]")) : theme.fg("dim", "[Tools]"),
		].join(" ");

		const items = this.items;
		const selected = this.selectedItem;
		const [listStart, listEnd] = getVisibleWindow(items.length, this.selectedIndex, MAX_LIST_LINES);
		const visibleItems = items.slice(listStart, listEnd);
		const bodyLines = selected ? wrapText(selected.content, bodyContentWidth) : ["No content."];
		const maxScroll = Math.max(0, bodyLines.length - MAX_BODY_LINES);
		const scroll = Math.max(0, Math.min(maxScroll, this.scroll));
		this.scroll = scroll;
		const visibleBody = bodyLines.slice(scroll, scroll + MAX_BODY_LINES);

		const output: string[] = [];
		const title = truncateToWidth(" Prompt Navigator ", innerWidth);
		const titlePad = Math.max(0, innerWidth - visibleWidth(title));
		output.push(border("╭") + theme.fg("accent", title) + border(`${"─".repeat(titlePad)}╮`));
		const shortcuts = selected?.path
			? "←→ tabs • ↑↓ items • PgUp/PgDn scroll • c copy text • e edit text • s source • o finder • Esc close"
			: "←→ tabs • ↑↓ items • PgUp/PgDn scroll • c copy text • e edit text • Esc close";
		output.push(
			row(
				`${inset}${theme.fg("dim", tabs)}`,
				`${inset}${
					theme.fg(
						"dim",
						this.busy ? "working..." : `cwd ${shortHomePath(this.data.currentDirectory)}`,
					)
				}`,
			),
		);
		output.push(
			row(`${inset}${theme.fg("dim", "shortcuts")}`, `${inset}${theme.fg("dim", shortcuts)}`),
		);
		output.push(row(
			`${inset}${
				this.tab === "session"
					? theme.fg("dim", `${items.length} session views`)
					: this.tab === "system"
					? theme.fg("dim", `${items.length} prompt blocks`)
					: theme.fg("dim", `${this.data.activeToolCount}/${this.data.totalToolCount} active tools`)
			}`,
			selected?.path
				? `${inset}${theme.fg("dim", shortPath(selected.path, this.data.currentDirectory))}`
				: `${inset}${theme.fg("dim", selected?.meta ?? "no path")}`,
		));
		output.push(row("", `${inset}${theme.bold(selected?.title ?? "No selection")}`));

		for (let i = 0; i < MAX_BODY_LINES; i++) {
			const item = visibleItems[i];
			const listLine = item
				? (listStart + i === this.selectedIndex
					? `${inset}${
						theme.fg("accent", truncateToWidth(`▶ ${item.label}`, listContentWidth, "…", true))
					}`
					: `${inset}${truncateToWidth(`  ${item.label}`, listContentWidth, "…", true)}`)
				: "";
			const bodyLine = `${inset}${visibleBody[i] ?? ""}`;
			output.push(row(listLine, bodyLine));
		}

		const footerLeft = `${inset}${
			theme.fg(
				"dim",
				`item ${items.length === 0 ? 0 : this.selectedIndex + 1}/${items.length}`,
			)
		}`;
		const maxBodyLine = Math.min(bodyLines.length, scroll + MAX_BODY_LINES);
		const footerRight = theme.fg(
			"dim",
			`lines ${bodyLines.length === 0 ? 0 : scroll + 1}-${maxBodyLine}/${bodyLines.length}`,
		);
		output.push(row(footerLeft, `${inset}${footerRight}`));
		output.push(border(`╰${"─".repeat(innerWidth)}╯`));
		return output;
	}

	invalidate(): void {}
	dispose(): void {}
}

export class PromptNavigator {
	private pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	async open(ctx: NavigatorCtx): Promise<void> {
		if (!ctx.hasUI) {
			return;
		}

		const sessionManager = ctx.sessionManager as Partial<NavigatorCtx["sessionManager"]>;
		const sessionFile = sessionManager.getSessionFile?.();
		const sessionData: PromptSessionData = {};
		if (sessionFile) {
			sessionData.sessionFile = sessionFile;
			const rawFile = readIfExists(sessionFile);
			if (rawFile !== undefined) {
				sessionData.rawFile = rawFile;
			}
		}
		const sessionDir = sessionManager.getSessionDir?.();
		if (sessionDir) {
			sessionData.sessionDir = sessionDir;
		}
		const sessionId = sessionManager.getSessionId?.();
		if (sessionId) {
			sessionData.sessionId = sessionId;
		}
		const sessionName = sessionManager.getSessionName?.();
		if (sessionName) {
			sessionData.sessionName = sessionName;
		}
		const leafId = sessionManager.getLeafId?.();
		if (leafId !== undefined) {
			sessionData.leafId = leafId;
		}
		const header = sessionManager.getHeader?.();
		if (header !== undefined) {
			sessionData.header = header;
		}
		const entries = sessionManager.getEntries?.() as PromptSessionEntry[] | undefined;
		if (entries) {
			sessionData.entries = entries;
		}
		const branch = sessionManager.getBranch?.() as PromptSessionEntry[] | undefined;
		if (branch) {
			sessionData.branch = branch;
		}

		const data = createPromptNavigatorData(ctx, {
			activeToolNames: this.pi.getActiveTools(),
			allTools: this.pi.getAllTools(),
			sessionData,
		});
		const contentPadding = getEditorPaddingX(ctx.cwd);

		const copyText = async (item: PromptNavigatorItem) => {
			const result = await this.pi.exec("bash", [
				"-lc",
				"printf '%s' \"$1\" | pbcopy",
				"--",
				item.content,
			], {
				cwd: ctx.cwd,
			});
			if (result.code === 0) {
				ctx.ui.notify(`Copied text: ${item.title}`, "info");
				return;
			}

			ctx.ui.notify(result.stderr || "Failed to copy text", "error");
		};

		const openSource = async (path: string) => {
			const result = await this.pi.exec("open", ["-R", path], { cwd: ctx.cwd });
			if (result.code === 0) {
				ctx.ui.notify(`Revealed in Finder: ${path}`, "info");
				return;
			}

			ctx.ui.notify(result.stderr || "Failed to open Finder", "error");
		};

		const openText = async (item: PromptNavigatorItem) => {
			const editor = getEditorCommand();
			if (!editor) {
				ctx.ui.notify("No editor configured. Set $VISUAL or $EDITOR.", "warning");
				return;
			}

			const path = writePromptNavigatorTextFile(item.content, item.title);
			const result = await this.pi.exec(editor.command, [...editor.args, path], { cwd: ctx.cwd });
			if (result.code === 0) {
				ctx.ui.notify(`Opened text in editor: ${path}`, "info");
				return;
			}

			ctx.ui.notify(result.stderr || `Failed to launch editor: ${editor.command}`, "error");
		};

		const editSource = async (path: string) => {
			const editor = getEditorCommand();
			if (!editor) {
				ctx.ui.notify("No editor configured. Set $VISUAL or $EDITOR.", "warning");
				return;
			}

			const result = await this.pi.exec(editor.command, [...editor.args, path], { cwd: ctx.cwd });
			if (result.code === 0) {
				ctx.ui.notify(`Opened in editor: ${path}`, "info");
				return;
			}

			ctx.ui.notify(result.stderr || `Failed to launch editor: ${editor.command}`, "error");
		};

		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) =>
				new PromptNavigatorComponent(
					tui,
					theme,
					data,
					() => done(undefined),
					copyText,
					openSource,
					openText,
					editSource,
					contentPadding,
				),
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: "92%",
					maxHeight: "88%",
					margin: 1,
				},
			},
		);
	}
}
