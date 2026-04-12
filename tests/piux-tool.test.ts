import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PiuxTool } from "../src/modules/piux-tool.ts";

type ExecCall = {
	command: string;
	args: string[];
	options: Record<string, unknown> | undefined;
};

function createExecHarness(
	responses: Array<{ stdout: string; stderr?: string; code?: number; killed?: boolean }>,
) {
	const execCalls: ExecCall[] = [];
	const activeTools = ["read", "bash"];
	const queue = [...responses];
	const tool = new PiuxTool({
		exec: async (command, args, options) => {
			execCalls.push({
				command,
				args,
				options: options as Record<string, unknown> | undefined,
			});
			const result = queue.shift() ?? { stdout: "", stderr: "", code: 0, killed: false };
			return {
				stdout: result.stdout,
				stderr: result.stderr ?? "",
				code: result.code ?? 0,
				killed: result.killed ?? false,
			};
		},
		getActiveTools: () => [...activeTools],
		setActiveTools: (next) => {
			activeTools.splice(0, activeTools.length, ...next);
		},
	}, {
		artifactRoot: mkdtempSync(join(tmpdir(), "piux-tool-")),
	});

	return { tool, execCalls, activeTools, artifactRoot: tool.artifactRoot };
}

async function runTool(
	tool: PiuxTool,
	params: Record<string, unknown>,
) {
	return await tool.definition.execute(
		"tool-call-1",
		params,
		undefined,
		undefined,
		{} as never,
	);
}

void test("syncActive adds and removes piux without dropping other tools", (t) => {
	const { tool, activeTools, artifactRoot } = createExecHarness([]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	tool.syncActive(true);
	assert.deepEqual(activeTools, ["read", "bash", "piux"]);

	tool.syncActive(false);
	assert.deepEqual(activeTools, ["read", "bash"]);
});

void test("look screen captures the visible pane and writes an artifact", async (t) => {
	const { tool, execCalls, artifactRoot } = createExecHarness([
		{ stdout: "4\n" },
		{ stdout: "one\ntwo\nthree\n" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const result = await runTool(tool, { action: "look", mode: "screen" });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";

	assert.deepEqual(execCalls.map((call) => [call.command, call.args]), [
		["tmux", ["-L", "piux", "display-message", "-p", "-t", "piux:pi.0", "#{pane_height}"]],
		["tmux", ["-L", "piux", "capture-pane", "-pt", "piux:pi.0", "-S", "-4"]],
	]);
	assert.match(text, /one\ntwo\nthree/);
	assert.match(text, /look-1\.txt/);
	assert.equal(readFileSync(join(artifactRoot, "look-1.txt"), "utf8"), "one\ntwo\nthree\n");
});

void test("first look diff falls back to full screen and later diff returns changed rows", async (t) => {
	const { tool, artifactRoot } = createExecHarness([
		{ stdout: "3\n" },
		{ stdout: "alpha\nbeta\n" },
		{ stdout: "3\n" },
		{ stdout: "alpha\ngamma\n" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const first = await runTool(tool, { action: "look" });
	const firstText = first.content[0]?.type === "text" ? first.content[0].text : "";
	assert.match(firstText, /alpha\nbeta/);
	assert.equal(existsSync(join(artifactRoot, "look-1.txt")), true);

	const second = await runTool(tool, { action: "look" });
	const secondText = second.content[0]?.type === "text" ? second.content[0].text : "";
	assert.match(secondText, /@@ line 2/);
	assert.match(secondText, /- beta/);
	assert.match(secondText, /\+ gamma/);
	assert.equal(readFileSync(join(artifactRoot, "look-2.txt"), "utf8"), "alpha\ngamma\n");
});

void test("look last returns compact tail without writing artifacts", async (t) => {
	const { tool, artifactRoot } = createExecHarness([
		{ stdout: "\nfirst\n\nsecond\nthird\n" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const result = await runTool(tool, { action: "look", mode: "last", lines: 2 });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";

	assert.equal(text, "second\nthird");
	assert.equal(existsSync(join(artifactRoot, "look-1.txt")), false);
});

void test("do maps literal text, key names, and enter to tmux send-keys", async (t) => {
	const { tool, execCalls, artifactRoot } = createExecHarness([
		{ stdout: "" },
		{ stdout: "" },
		{ stdout: "" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const result = await runTool(tool, {
		action: "do",
		text: "/reload",
		keys: ["Escape", "[", "Z"],
		enter: true,
	});
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";

	assert.deepEqual(execCalls.map((call) => [call.command, call.args]), [
		["tmux", ["-L", "piux", "send-keys", "-t", "piux:pi.0", "-l", "--", "/reload"]],
		["tmux", ["-L", "piux", "send-keys", "-t", "piux:pi.0", "Escape", "[", "Z"]],
		["tmux", ["-L", "piux", "send-keys", "-t", "piux:pi.0", "Enter"]],
	]);
	assert.match(text, /sent text, keys, enter/);
});
