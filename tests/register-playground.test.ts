import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import register from "../src/index.ts";
import { PLAYGROUND_STATE_TYPE } from "../src/models/playground-session-state.ts";

type Entry =
	| { type: "header"; id: string }
	| { type: "custom"; id: string; customType: string; data?: unknown };

type LeaderActionContext = {
	openSubmenu: (kind: string, items: LeaderItem[]) => void;
};

type LeaderItem = {
	key: string;
	label: string | ((...args: unknown[]) => string);
	run: (ctx: LeaderActionContext) => void | Promise<void>;
	options?: Record<string, unknown>;
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

function createHarness(options?: { entries?: Entry[] }) {
	const cwd = mkdtempSync(join(tmpdir(), "pi-playground-"));
	const commands = new Map<string, unknown>();
	const tools = new Map<string, any>();
	const activeTools = { current: ["read", "bash"] };
	const entries: Entry[] = options?.entries ? [...options.entries] : [{ type: "header", id: "0" }];
	const widgets = new Map<string, unknown>();
	const notifications: Array<{ message: string; type?: string }> = [];
	const execCalls: Array<{
		command: string;
		args: string[];
		options: Record<string, unknown> | undefined;
	}> = [];
	let nextEntryId = entries.length;
	const events = createEvents();
	const sharedEvents = createSharedEvents();

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
		},
		sessionManager: {
			getEntries() {
				return entries;
			},
			getSessionFile() {
				return join(cwd, "session.jsonl");
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
			entries.push({
				type: "custom",
				id: String(nextEntryId),
				customType,
				data,
			});
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
		notifications,
		tools,
		startSession: async () => {
			await events.emit("session_start", { type: "session_start", reason: "resume" }, ctx);
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
		cleanup: () => {
			rmSync(cwd, { recursive: true, force: true });
		},
	};
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

void test("playground is inactive by default and exposes no slash command", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);

	await harness.startSession();

	assert.equal(harness.commands.size, 0);
	assert.equal(harness.widgets.get("pi-playground"), undefined);
	assert.equal(harness.activeTools.current.includes("piux"), false);

	const items = harness.getLeaderItems();
	assert.equal(items.length, 1);
	assert.equal(items[0]?.key, "g");

	await items[0]?.run({
		openSubmenu() {
			throw new Error("inactive playground should activate, not open submenu");
		},
	});

	assert.equal(harness.widgets.has("pi-playground"), true);
	assert.equal(harness.activeTools.current.includes("piux"), true);
	assert.deepEqual(getLatestState(harness.entries)?.data, {
		active: true,
		requestLogging: false,
	});
	assert.equal(existsSync(join(harness.cwd, ".pi", "playground", "provider-request.enabled")),
		false);
});

void test("active playground reopens as a leader submenu after session reload", async (t) => {
	const harness = createActiveHarness();
	t.after(harness.cleanup);

	await harness.startSession();

	assert.equal(harness.widgets.has("pi-playground"), true);
	assert.equal(harness.activeTools.current.includes("piux"), true);

	const submenu = await openPlaygroundSubmenu(harness);
	assert.equal(submenu?.kind, "playground");
	assert.deepEqual(submenu?.items.map((item) => item.key), ["r"]);
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
