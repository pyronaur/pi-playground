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

function renderResultText(tool: PiuxTool, input: { text: string; expanded?: boolean }): string[] {
	const component = tool.definition.renderResult?.(
		{
			content: [{ type: "text", text: input.text }],
			details: {},
			isError: false,
		},
		{ isPartial: false, expanded: input.expanded ?? false },
		{
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		},
	) as { render(width: number): string[] };
	return component.render(120).map((line) => line.trimEnd());
}

function renderCallText(tool: PiuxTool, args: Record<string, unknown>): string[] {
	const component = tool.definition.renderCall?.(
		args,
		{
			fg: (_color: string, text: string) => text,
			bold: (text: string) => text,
		},
		{
			lastComponent: undefined,
			state: {},
			invalidate() {},
			executionStarted: false,
			isPartial: false,
		},
	) as { render(width: number): string[] };
	return component.render(200).map((line) => line.trimEnd());
}

function assertFullCaptureCalls(execCalls: ExecCall[]): void {
	assert.deepEqual(execCalls.map((call) => [call.command, call.args]), [
		["tmux", ["-L", "piux", "display-message", "-p", "-t", "piux:pi.0", "#{pane_height}"]],
		["tmux", ["-L", "piux", "capture-pane", "-pt", "piux:pi.0", "-S", "-"]],
	]);
}

void test("syncActive adds and removes piux_client without dropping other tools", (t) => {
	const { tool, activeTools, artifactRoot } = createExecHarness([]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	tool.syncActive(true);
	assert.deepEqual(activeTools, ["read", "bash", "piux_client"]);

	tool.syncActive(false);
	assert.deepEqual(activeTools, ["read", "bash"]);
});

void test("look screen returns visible screen from full-output snapshot and saves full output", async (t) => {
	const { tool, execCalls, artifactRoot } = createExecHarness([
		{ stdout: "3\n" },
		{ stdout: "history-1\nhistory-2\nscreen-1\nscreen-2\nscreen-3\n" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const result = await runTool(tool, { action: "look", mode: "screen" });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";

	assertFullCaptureCalls(execCalls);
	assert.match(text, /screen-1\nscreen-2\nscreen-3/);
	assert.match(text, /look-1\.txt/);
	assert.equal(readFileSync(join(artifactRoot, "look-1.txt"), "utf8"),
		"history-1\nhistory-2\nscreen-1\nscreen-2\nscreen-3\n");
});

void test("look full_output returns complete tmux scrollback and saves one snapshot", async (t) => {
	const { tool, execCalls, artifactRoot } = createExecHarness([
		{ stdout: "2\n" },
		{ stdout: "history-1\nhistory-2\nscreen-1\nscreen-2\n" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const result = await runTool(tool, { action: "look", mode: "full_output" });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";

	assertFullCaptureCalls(execCalls);
	assert.match(text, /history-1\nhistory-2\nscreen-1\nscreen-2/);
	assert.equal(readFileSync(join(artifactRoot, "look-1.txt"), "utf8"),
		"history-1\nhistory-2\nscreen-1\nscreen-2\n");
});

void test("look diff compares full output and ignores input area", async (t) => {
	const { tool, artifactRoot } = createExecHarness([
		{ stdout: "4\n" },
		{ stdout: "alpha\nbeta\n────────────────\ninput old\nstatus\n" },
		{ stdout: "4\n" },
		{ stdout: "alpha\nbeta\n────────────────\ninput new\nstatus\n" },
		{ stdout: "4\n" },
		{ stdout: "alpha\ngamma\n────────────────\ninput newer\nstatus\n" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const first = await runTool(tool, { action: "look" });
	const firstText = first.content[0]?.type === "text" ? first.content[0].text : "";
	assert.match(firstText, /alpha\nbeta/);
	assert.equal(existsSync(join(artifactRoot, "look-1.txt")), true);

	const second = await runTool(tool, { action: "look" });
	const secondText = second.content[0]?.type === "text" ? second.content[0].text : "";
	assert.match(secondText, /No output changes\./);

	const third = await runTool(tool, { action: "look" });
	const thirdText = third.content[0]?.type === "text" ? third.content[0].text : "";
	assert.match(thirdText, /@@ line 2/);
	assert.match(thirdText, /- beta/);
	assert.match(thirdText, /\+ gamma/);
	assert.equal(readFileSync(join(artifactRoot, "look-3.txt"), "utf8"),
		"alpha\ngamma\n────────────────\ninput newer\nstatus\n");
});

void test("look last returns compact tail from full output and saves full-output artifact", async (t) => {
	const { tool, artifactRoot } = createExecHarness([
		{ stdout: "3\n" },
		{ stdout: "\nhistory\nfirst\n\nsecond\nthird\n" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const result = await runTool(tool, { action: "look", mode: "last", lines: 2 });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";

	assert.equal(text, "second\nthird");
	assert.equal(readFileSync(join(artifactRoot, "look-1.txt"), "utf8"),
		"\nhistory\nfirst\n\nsecond\nthird\n");
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

void test("collapsed render shows only the last 5 lines and expanded shows full output", (t) => {
	const { tool, artifactRoot } = createExecHarness([]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const output = "one\ntwo\nthree\nfour\nfive\nsix\nseven";
	assert.deepEqual(renderResultText(tool, { text: output }), [
		"three",
		"four",
		"five",
		"six",
		"seven",
	]);
	assert.deepEqual(renderResultText(tool, { text: output, expanded: true }), [
		"one",
		"two",
		"three",
		"four",
		"five",
		"six",
		"seven",
	]);
});

void test("renderCall shows full piux_client args in the title", (t) => {
	const { tool, artifactRoot } = createExecHarness([]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	assert.deepEqual(renderCallText(tool, { action: "look", mode: "last", lines: 5 }), [
		"piux_client action=look mode=last lines=5",
	]);
	assert.deepEqual(renderCallText(tool, {
		action: "do",
		text: "/reload",
		keys: ["Escape", "[", "Z"],
		enter: true,
	}), [
		"piux_client action=do text=\"/reload\" keys=[\"Escape\",\"[\",\"Z\"] enter=true",
	]);
});
