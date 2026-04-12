import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import register from "../src/index.ts";
import {
	PLAYGROUND_EXPOSURE_TYPE,
	PlaygroundExposureMessage,
} from "../src/models/playground-exposure-message.ts";
import { PLAYGROUND_STATE_TYPE } from "../src/models/playground-session-state.ts";

type Entry =
	| { type: "header"; id: string }
	| { type: "custom"; id: string; customType: string; data?: unknown }
	| {
		type: "custom_message";
		id: string;
		customType: string;
		content: string;
		display: boolean;
		details?: unknown;
	}
	| {
		type: "compaction";
		id: string;
		summary: string;
		firstKeptEntryId: string;
		tokensBefore: number;
	};

type LeaderActionContext = {
	openSubmenu: (kind: string, items: LeaderItem[]) => void;
};

type LeaderItem = {
	key: string;
	label: string | ((...args: unknown[]) => string);
	run: (ctx: LeaderActionContext) => void | Promise<void>;
	options?: Record<string, unknown>;
};

type RegisteredCommand = {
	description?: string;
	handler: (args: string, ctx: unknown) => Promise<void>;
};

function createEvents() {
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();

	return {
		on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
			const current = handlers.get(name) ?? [];
			current.push(handler);
			handlers.set(name, current);
		},
		async emit(name: string, event: unknown, ctx: unknown) {
			for (const handler of handlers.get(name) ?? []) {
				await handler(event, ctx);
			}
		},
	};
}

function createSharedEvents() {
	const handlers = new Map<string, Array<(event: unknown) => unknown>>();

	return {
		on(name: string, handler: (event: unknown) => unknown) {
			const current = handlers.get(name) ?? [];
			current.push(handler);
			handlers.set(name, current);
			return () => {
				handlers.set(name, (handlers.get(name) ?? []).filter((item) => item !== handler));
			};
		},
		emit(name: string, event: unknown) {
			for (const handler of handlers.get(name) ?? []) {
				handler(event);
			}
		},
	};
}

function createHarness(options?: {
	entries?: Entry[];
	currentBranch?: Entry[];
	sessionId?: string;
	sessionFile?: string;
	sessionStart?: { reason: string; previousSessionFile?: string };
}) {
	const cwd = mkdtempSync(join(tmpdir(), "pi-playground-"));
	const sessionId = options?.sessionId ?? "session-123";
	const sessionFile = options?.sessionFile ?? join(cwd, "session.jsonl");
	const commands = new Map<string, unknown>();
	const renderers = new Map<string, unknown>();
	const tools = new Map<string, any>();
	const activeTools = { current: ["read", "bash"] };
	const entries: Entry[] = options?.entries ? [...options.entries] : [{ type: "header", id: "0" }];
	const widgets = new Map<string, unknown>();
	const customCalls: Array<{ options: Record<string, unknown> | undefined }> = [];
	const branch = { current: options?.currentBranch ? [...options.currentBranch] : [] as Entry[] };
	const notifications: Array<{ message: string; type?: string }> = [];
	const execCalls: Array<{
		command: string;
		args: string[];
		options: Record<string, unknown> | undefined;
	}> = [];
	let nextEntryId = entries.length;
	const events = createEvents();
	const sharedEvents = createSharedEvents();
	if (branch.current.length === 0) {
		branch.current = entries.filter((entry) => entry.type !== "header");
	}

	const ctx = {
		hasUI: true,
		cwd,
		ui: {
			notify(message: string, type?: string) {
				notifications.push({ message, type });
			},
			setWidget(key: string, content: unknown) {
				widgets.set(key, content);
			},
			custom(
				factory: (
					tui: { requestRender: () => void },
					theme: unknown,
					kb: unknown,
					done: (value: unknown) => void,
				) => unknown,
				options?: Record<string, unknown>,
			) {
				customCalls.push({ options });
				factory({ requestRender() {} }, {
					fg(_color: string, value: string) {
						return value;
					},
					bold(value: string) {
						return value;
					},
				}, undefined, () => {});
				return Promise.resolve(undefined);
			},
		},
		getSystemPrompt() {
			return [
				"Built-in base prompt.",
				"",
				"# Project Context",
				"",
				`## ${join(cwd, "AGENTS.md")}`,
				"",
				"project instructions",
				"",
				"Current date: 2026-04-12",
				`Current working directory: ${cwd}`,
			].join("\n");
		},
		sessionManager: {
			getBranch() {
				return [...branch.current];
			},
			getEntries() {
				return entries;
			},
			getSessionId() {
				return sessionId;
			},
			getSessionFile() {
				return sessionFile;
			},
		},
		modelRegistry: {
			async getApiKeyAndHeaders() {
				return { ok: true, apiKey: "secret-key", headers: { authorization: "Bearer secret" } };
			},
		},
		model: {
			provider: "test-provider",
			id: "test-model",
			api: "responses",
			baseUrl: "https://example.test",
		},
	};

	const pi = {
		events: sharedEvents,
		exec(command: string, args: string[], options?: Record<string, unknown>) {
			execCalls.push({ command, args, options });
			return Promise.resolve({ stdout: "", stderr: "", code: 0, killed: false });
		},
		on(name: string, handler: (event: unknown, eventCtx: typeof ctx) => unknown) {
			events.on(name, handler);
		},
		registerMessageRenderer(customType: string, renderer: unknown) {
			renderers.set(customType, renderer);
		},
		registerCommand(name: string, command: unknown) {
			commands.set(name, command);
		},
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		getActiveTools() {
			return [...activeTools.current];
		},
		getAllTools() {
			return [...tools.values()];
		},
		setActiveTools(toolNames: string[]) {
			activeTools.current = [...toolNames];
		},
		appendEntry(customType: string, data?: unknown) {
			const entry = {
				type: "custom",
				id: String(nextEntryId),
				customType,
				data,
			} satisfies Extract<Entry, { type: "custom" }>;
			entries.push(entry);
			branch.current.push(entry);
			nextEntryId += 1;
		},
		sendMessage(message: {
			customType: string;
			content: string;
			display: boolean;
			details?: unknown;
		}) {
			const entry = {
				type: "custom_message",
				id: String(nextEntryId),
				customType: message.customType,
				content: message.content,
				display: message.display,
				details: message.details,
			} satisfies Extract<Entry, { type: "custom_message" }>;
			entries.push(entry);
			branch.current.push(entry);
			nextEntryId += 1;
		},
	};

	register(pi as never);

	return {
		activeTools,
		cwd,
		commands,
		entries,
		execCalls,
		widgets,
		customCalls,
		notifications,
		renderers,
		setBranch: (nextEntries: Entry[]) => {
			branch.current = [...nextEntries];
		},
		tools,
		startSession: async () => {
			await events.emit("session_start", {
				type: "session_start",
				reason: options?.sessionStart?.reason ?? "resume",
				previousSessionFile: options?.sessionStart?.previousSessionFile,
			}, ctx);
		},
		emit: async (name: string, event: unknown) => {
			await events.emit(name, event, ctx);
		},
		getLeaderItems: () => {
			const items: LeaderItem[] = [];
			sharedEvents.emit("pi-leader", {
				add(
					key: string,
					label: LeaderItem["label"],
					run: LeaderItem["run"],
					options?: Record<string, unknown>,
				) {
					items.push({ key, label, run, options });
				},
			});
			return items;
		},
		runCommand: async (name: string, args = "") => {
			const command = commands.get(name) as RegisteredCommand | undefined;
			await command?.handler(args, ctx);
		},
		cleanup: () => {
			rmSync(cwd, { recursive: true, force: true });
		},
	};
}

function getExposureMessages(entries: Entry[]) {
	return entries.filter((entry): entry is Extract<Entry, { type: "custom_message" }> => {
		return entry.type === "custom_message" && entry.customType === PLAYGROUND_EXPOSURE_TYPE;
	});
}

function renderMessageText(
	renderer: (
		message: any,
		options: { expanded: boolean },
		theme: any,
	) => { render: (width: number) => string[] },
	message: { content: string; details: unknown },
	expanded = false,
) {
	return renderer(message, { expanded }, {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	}).render(120)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function getLatestState(entries: Entry[]) {
	return [...entries]
		.reverse()
		.find((entry): entry is Extract<Entry, { type: "custom" }> => {
			return entry.type === "custom" && entry.customType === PLAYGROUND_STATE_TYPE;
		});
}

function createActiveHarness() {
	return createHarness({
		entries: [
			{ type: "header", id: "0" },
			{
				type: "custom",
				id: "1",
				customType: PLAYGROUND_STATE_TYPE,
				data: { active: true, requestLogging: false },
			},
		],
	});
}

function createActiveHarnessWithExposure() {
	const sessionFile = "/tmp/current/session.jsonl";
	const exposure = PlaygroundExposureMessage.create({
		compactionId: "root",
		sessionId: "session-123",
		sessionFile: sessionFile,
	});

	return createHarness({
		sessionFile,
		entries: [
			{ type: "header", id: "0" },
			{
				type: "custom",
				id: "1",
				customType: PLAYGROUND_STATE_TYPE,
				data: { active: true, requestLogging: false },
			},
			{
				type: "custom_message",
				id: "2",
				customType: exposure.toMessage().customType,
				content: exposure.toMessage().content,
				display: exposure.toMessage().display,
				details: exposure.toMessage().details,
			},
		],
	});
}

function createForkedHarnessWithOldExposure() {
	const previousSessionFile = "/tmp/previous/session.jsonl";
	const exposure = PlaygroundExposureMessage.create({
		compactionId: "root",
		sessionId: "old-session-id",
		sessionFile: previousSessionFile,
	});

	return createHarness({
		sessionId: "new-session-id",
		sessionFile: "/tmp/current/session.jsonl",
		sessionStart: { reason: "fork", previousSessionFile },
		entries: [
			{ type: "header", id: "0" },
			{
				type: "custom",
				id: "1",
				customType: PLAYGROUND_STATE_TYPE,
				data: { active: true, requestLogging: false },
			},
			{
				type: "custom_message",
				id: "2",
				customType: exposure.toMessage().customType,
				content: exposure.toMessage().content,
				display: exposure.toMessage().display,
				details: exposure.toMessage().details,
			},
		],
	});
}

function createTreeNavigationHarness() {
	const staleExposure = PlaygroundExposureMessage.create({
		compactionId: "root",
		sessionId: "old-session-id",
		sessionFile: "/tmp/old/session.jsonl",
	});
	const currentExposure = PlaygroundExposureMessage.create({
		compactionId: "root",
		sessionId: "current-session-id",
		sessionFile: "/tmp/current/session.jsonl",
	});
	const entries: Entry[] = [
		{ type: "header", id: "0" },
		{
			type: "custom",
			id: "1",
			customType: PLAYGROUND_STATE_TYPE,
			data: { active: true, requestLogging: false },
		},
		{
			type: "custom_message",
			id: "2",
			customType: staleExposure.toMessage().customType,
			content: staleExposure.toMessage().content,
			display: staleExposure.toMessage().display,
			details: staleExposure.toMessage().details,
		},
		{
			type: "custom_message",
			id: "3",
			customType: currentExposure.toMessage().customType,
			content: currentExposure.toMessage().content,
			display: currentExposure.toMessage().display,
			details: currentExposure.toMessage().details,
		},
	];

	return createHarness({
		entries,
		sessionId: "current-session-id",
		sessionFile: "/tmp/current/session.jsonl",
		currentBranch: entries.slice(1),
	});
}

async function openPlaygroundSubmenu(harness: ReturnType<typeof createHarness>) {
	const items = harness.getLeaderItems();
	let submenu: { kind: string; items: LeaderItem[] } | undefined;
	await items[0]?.run({
		openSubmenu(kind, nextItems) {
			submenu = { kind, items: nextItems };
		},
	});

	return submenu;
}

void test("playground is inactive by default and exposes fallback slash commands", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);

	await harness.startSession();

	assert.deepEqual([...harness.commands.keys()].sort(), [
		"playground-activate",
		"playground-prompt-navigator",
		"playground-toggle-request-logging",
	]);
	assert.equal(harness.widgets.get("pi-playground"), undefined);
	assert.equal(harness.activeTools.current.includes("piux_client"), false);

	const items = harness.getLeaderItems();
	assert.equal(items.length, 1);
	assert.equal(items[0]?.key, "g");

	await items[0]?.run({
		openSubmenu() {
			throw new Error("inactive playground should activate, not open submenu");
		},
	});

	assert.equal(harness.widgets.has("pi-playground"), true);
	assert.equal(harness.activeTools.current.includes("piux_client"), true);
	assert.deepEqual(getLatestState(harness.entries)?.data, {
		active: true,
		requestLogging: false,
	});
	assert.equal(existsSync(join(harness.cwd, ".pi", "playground", "provider-request.enabled")),
		false);
});

void test("slash command activates inactive playground without leader", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);

	await harness.startSession();
	await harness.runCommand("playground-activate");

	assert.equal(harness.widgets.has("pi-playground"), true);
	assert.equal(harness.activeTools.current.includes("piux_client"), true);
	assert.deepEqual(getLatestState(harness.entries)?.data, {
		active: true,
		requestLogging: false,
	});
});

void test("slash command opens prompt navigator overlay when playground is active", async (t) => {
	const harness = createActiveHarness();
	t.after(harness.cleanup);

	await harness.startSession();
	await harness.runCommand("playground-prompt-navigator");

	assert.equal(harness.customCalls.length, 1);
	assert.deepEqual(harness.customCalls[0]?.options, {
		overlay: true,
		overlayOptions: {
			anchor: "center",
			width: "92%",
			maxHeight: "88%",
			margin: 1,
		},
	});
});

void test("active playground reopens as a leader submenu after session reload", async (t) => {
	const harness = createActiveHarness();
	t.after(harness.cleanup);

	await harness.startSession();

	assert.equal(harness.widgets.has("pi-playground"), true);
	assert.equal(harness.activeTools.current.includes("piux_client"), true);

	const submenu = await openPlaygroundSubmenu(harness);
	assert.equal(submenu?.kind, "playground");
	assert.deepEqual(submenu?.items.map((item) => item.key), ["p", "r"]);
});

void test("active playground resume does not duplicate an existing exposure message", async (t) => {
	const harness = createActiveHarnessWithExposure();
	t.after(harness.cleanup);

	await harness.startSession();

	assert.equal(getExposureMessages(harness.entries).length, 1);
});

void test("forked active session injects a new exposure message when the session id changes", async (t) => {
	const harness = createForkedHarnessWithOldExposure();
	t.after(harness.cleanup);

	await harness.startSession();

	const exposures = getExposureMessages(harness.entries);
	assert.equal(exposures.length, 2);
	assert.match(exposures.at(-1)?.content ?? "", /new-session-id/);
	assert.match(exposures.at(-1)?.content ?? "", /\/tmp\/current\/session\.jsonl/);
});

void test("tree navigation injects the current session exposure on the new branch", async (t) => {
	const harness = createTreeNavigationHarness();
	t.after(harness.cleanup);

	await harness.startSession();
	assert.equal(getExposureMessages(harness.entries).length, 2);

	harness.setBranch(harness.entries.filter((entry) => entry.id === "1" || entry.id === "2"));
	await harness.emit("session_tree", {
		type: "session_tree",
		newLeafId: "1",
		oldLeafId: "3",
	});

	const exposures = getExposureMessages(harness.entries);
	assert.equal(exposures.length, 3);
	assert.match(exposures.at(-1)?.content ?? "", /current-session-id/);
	assert.match(exposures.at(-1)?.content ?? "", /\/tmp\/current\/session\.jsonl/);
});

void test("activating playground injects one visible exposure message with session metadata", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);

	await harness.startSession();

	const items = harness.getLeaderItems();
	await items[0]?.run({
		openSubmenu() {
			throw new Error("inactive playground should activate, not open submenu");
		},
	});

	const exposures = getExposureMessages(harness.entries);
	assert.equal(exposures.length, 1);
	assert.equal(exposures[0]?.display, true);
	assert.match(exposures[0]?.content ?? "", /session-123/);
	assert.match(exposures[0]?.content ?? "", /session\.jsonl/);
	assert.match(exposures[0]?.content ?? "", /@docs\/piux\.md/);
	assert.equal(harness.renderers.has(PLAYGROUND_EXPOSURE_TYPE), true);
});

void test("active playground re-injects once after compaction", async (t) => {
	const harness = createActiveHarness();
	t.after(harness.cleanup);

	await harness.startSession();

	assert.equal(getExposureMessages(harness.entries).length, 1);

	harness.entries.push({
		type: "compaction",
		id: String(harness.entries.length),
		summary: "summary",
		firstKeptEntryId: "1",
		tokensBefore: 100,
	});
	harness.setBranch(harness.entries.filter((entry) => entry.type !== "header"));

	await harness.emit("session_compact", {
		type: "session_compact",
		compactionEntry: harness.entries.at(-1),
		fromExtension: false,
	});

	assert.equal(getExposureMessages(harness.entries).length, 2);
	await harness.emit("session_compact", {
		type: "session_compact",
		compactionEntry: harness.entries.at(-2),
		fromExtension: false,
	});
	assert.equal(getExposureMessages(harness.entries).length, 2);
});

void test("exposure message renderer collapses to 3 lines and expands to the full body", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);

	await harness.startSession();

	const renderer = harness.renderers.get(PLAYGROUND_EXPOSURE_TYPE);
	assert.equal(typeof renderer, "function");

	const exposure = PlaygroundExposureMessage.create({
		compactionId: "root",
		sessionId: "session-123",
		sessionFile: join(harness.cwd, "session.jsonl"),
	});
	const collapsed = renderMessageText(renderer as never, exposure.toMessage());
	const expanded = renderMessageText(renderer as never, exposure.toMessage(), true);

	assert.deepEqual(collapsed, [
		"Playground session context",
		"Session ID: session-123",
		`Session file: ${join(harness.cwd, "session.jsonl")}`,
		"...",
	]);
	assert.deepEqual(expanded, [
		"Playground session context",
		"Session ID: session-123",
		`Session file: ${join(harness.cwd, "session.jsonl")}`,
		"Runbook: @docs/piux.md",
	]);
});

void test("request logging toggle persists in session state and writes sidecar logs", async (t) => {
	const harness = createActiveHarness();
	t.after(harness.cleanup);

	await harness.startSession();

	const submenu = await openPlaygroundSubmenu(harness);
	const toggle = submenu?.items.find((item) => item.key === "r");
	assert.ok(toggle);
	await toggle.run({
		openSubmenu() {},
	});

	assert.deepEqual(getLatestState(harness.entries)?.data, {
		active: true,
		requestLogging: true,
	});
	assert.equal(existsSync(join(harness.cwd, ".pi", "playground", "provider-request.enabled")),
		false);

	await harness.emit("before_provider_request", {
		type: "before_provider_request",
		payload: {
			messages: [{ role: "user", content: "show payload" }],
		},
	});

	const logPath = join(harness.cwd, "session.requests.jsonl");
	assert.equal(existsSync(logPath), true);
	assert.match(readFileSync(logPath, "utf8"), /before_provider_request/);
	assert.equal(
		harness.notifications.some((item) => /playground request debug on/.test(item.message)),
		true,
	);
});

void test("slash command toggles request logging without leader", async (t) => {
	const harness = createActiveHarness();
	t.after(harness.cleanup);

	await harness.startSession();
	await harness.runCommand("playground-toggle-request-logging");

	assert.deepEqual(getLatestState(harness.entries)?.data, {
		active: true,
		requestLogging: true,
	});
	assert.equal(
		harness.notifications.some((item) => /playground request debug on/.test(item.message)),
		true,
	);
	assert.equal(existsSync(join(harness.cwd, ".pi", "playground", "provider-request.enabled")),
		false);
});

void test("prompt navigator command warns when playground is inactive", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);

	await harness.startSession();
	await harness.runCommand("playground-prompt-navigator");

	assert.equal(harness.customCalls.length, 0);
	assert.equal(
		harness.notifications.some((item) => /Activate playground first/.test(item.message)),
		true,
	);
});
