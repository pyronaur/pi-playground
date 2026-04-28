import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PpTool } from "../src/modules/pp-tool.ts";

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
	const tool = new PpTool({
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
		artifactRoot: mkdtempSync(join(tmpdir(), "pp-tool-")),
		originSurfaceId: "surface:origin",
	});

	return { tool, execCalls, activeTools, artifactRoot: tool.artifactRoot };
}

async function runTool(
	tool: PpTool,
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

function renderResultText(tool: PpTool, input: { text: string; expanded?: boolean }): string[] {
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

function renderCallText(tool: PpTool, args: Record<string, unknown>): string[] {
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

function splitResponse(): { stdout: string } {
	return { stdout: "OK surface:attached workspace:74\n" };
}

function listWorkspacesResponse(
	workspaces: Array<{ ref: string; id?: string }>,
): { stdout: string } {
	return { stdout: `${JSON.stringify({ workspaces })}\n` };
}

function listPanesResponse(input: {
	workspaceRef: string;
	workspaceId?: string;
	surfaces?: Array<{ ref: string; id?: string }>;
}): { stdout: string } {
	return {
		stdout: `${
			JSON.stringify({
				workspace_ref: input.workspaceRef,
				workspace_id: input.workspaceId,
				panes: [{
					surface_refs: input.surfaces?.map((surface) => surface.ref) ?? [],
					surface_ids: input.surfaces?.map((surface) => surface.id ?? surface.ref) ?? [],
				}],
			})
		}\n`,
	};
}

function assertFirstSplit(execCalls: ExecCall[]): void {
	assert.deepEqual(execCalls[0], {
		command: "cmux",
		args: splitArgs("origin"),
		options: { timeout: 5000 },
	});
}

function splitArgs(surface: string): string[] {
	return ["new-split", "right", "--surface", `surface:${surface}`];
}

function targetFlags(surface: string, workspace?: string): string[] {
	const args: string[] = [];
	if (workspace) {
		args.push("--workspace", workspace);
	}
	const surfaceArg = surface.includes(":") || /^[0-9A-F-]{36}$/iu.test(surface)
		? surface
		: `surface:${surface}`;
	args.push("--surface", surfaceArg);
	return args;
}

function readArgs(surface: string, scrollback = false, workspace = "workspace:74"): string[] {
	const args = ["read-screen", ...targetFlags(surface, workspace)];
	if (scrollback) {
		args.push("--scrollback");
	}

	return args;
}

function sendArgs(
	command: "send" | "send-key",
	surface: string,
	value: string,
	workspace = "workspace:74",
): string[] {
	return [command, ...targetFlags(surface, workspace), value];
}

function listWorkspacesArgs(): string[] {
	return ["--json", "--id-format", "both", "list-workspaces"];
}

function listPanesArgs(workspace: string): string[] {
	return ["--json", "--id-format", "both", "list-panes", "--workspace", workspace];
}

function assertCmuxArgs(execCalls: ExecCall[], expected: string[][]): void {
	assert.deepEqual(execCalls.map((call) => call.args), expected);
}

void test("syncActive adds and removes pp without dropping other tools", (t) => {
	const { tool, activeTools, artifactRoot } = createExecHarness([]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	tool.syncActive(true);
	assert.deepEqual(activeTools, ["read", "bash", "pp"]);

	tool.syncActive(false);
	assert.deepEqual(activeTools, ["read", "bash"]);
});

void test("look screen creates one split, captures visible output, and saves full output", async (t) => {
	const { tool, execCalls, artifactRoot } = createExecHarness([
		splitResponse(),
		{ stdout: "history-1\nhistory-2\nscreen-1\nscreen-2\nscreen-3\n" },
		{ stdout: "visible-1\nvisible-2\nvisible-3\n" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const result = await runTool(tool, { action: "look", mode: "screen" });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";

	assertCmuxArgs(execCalls, [
		splitArgs("origin"),
		readArgs("attached", true),
		readArgs("attached"),
	]);
	assert.match(text, /visible-1\nvisible-2\nvisible-3/);
	assert.match(text, /look-1\.txt/);
	assert.equal(readFileSync(join(artifactRoot, "look-1.txt"), "utf8"),
		"history-1\nhistory-2\nscreen-1\nscreen-2\nscreen-3\n");
});

void test("look full_output returns complete cmux scrollback and saves one snapshot", async (t) => {
	const { tool, execCalls, artifactRoot } = createExecHarness([
		splitResponse(),
		{ stdout: "history-1\nhistory-2\nscreen-1\nscreen-2\n" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const result = await runTool(tool, { action: "look", mode: "full_output" });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";

	assertFirstSplit(execCalls);
	assert.deepEqual(execCalls[1]?.args, readArgs("attached", true));
	assert.match(text, /history-1\nhistory-2\nscreen-1\nscreen-2/);
	assert.equal(readFileSync(join(artifactRoot, "look-1.txt"), "utf8"),
		"history-1\nhistory-2\nscreen-1\nscreen-2\n");
});

void test("look recreates the playground pane when the cached surface was closed", async (t) => {
	const { tool, execCalls, artifactRoot } = createExecHarness([
		splitResponse(),
		{ stdout: "before close\n" },
		{ stdout: "", stderr: "invalid_params: Surface is not a terminal\n", code: 1 },
		listWorkspacesResponse([]),
		{ stdout: "OK surface:replacement workspace:74\n" },
		{ stdout: "after recreate\n" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	await runTool(tool, { action: "look", mode: "full_output" });
	const result = await runTool(tool, { action: "look", mode: "full_output" });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";

	assertCmuxArgs(execCalls, [
		splitArgs("origin"),
		readArgs("attached", true),
		readArgs("attached", true),
		listWorkspacesArgs(),
		splitArgs("origin"),
		readArgs("replacement", true),
	]);
	assert.match(text, /after recreate/);
	assert.equal(readFileSync(join(artifactRoot, "look-2.txt"), "utf8"), "after recreate\n");
});

void test("look recovers a moved playground pane by scanning workspaces", async (t) => {
	const movedWorkspaceId = "E4AD46BF-F625-486E-99F0-9A73E9E24D81";
	const movedSurfaceId = "A9F3E47D-14CB-4FB7-B4F0-E31CFADE5BE0";
	const { tool, execCalls, artifactRoot } = createExecHarness([
		splitResponse(),
		{ stdout: "before move\n" },
		{ stdout: "", stderr: "invalid_params: Surface is not a terminal\n", code: 1 },
		listWorkspacesResponse([{ ref: "workspace:74" }, { ref: "workspace:83" }]),
		listPanesResponse({ workspaceRef: "workspace:74", surfaces: [] }),
		listPanesResponse({
			workspaceRef: "workspace:83",
			workspaceId: movedWorkspaceId,
			surfaces: [{ ref: "surface:attached", id: movedSurfaceId }],
		}),
		{ stdout: "after move\n" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	await runTool(tool, { action: "look", mode: "full_output" });
	const result = await runTool(tool, { action: "look", mode: "full_output" });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";

	assertCmuxArgs(execCalls, [
		splitArgs("origin"),
		readArgs("attached", true),
		readArgs("attached", true),
		listWorkspacesArgs(),
		listPanesArgs("workspace:74"),
		listPanesArgs("workspace:83"),
		readArgs(movedSurfaceId, true, movedWorkspaceId),
	]);
	assert.equal(execCalls.filter((call) => call.args[0] === "new-split").length, 1);
	assert.match(text, /after move/);
	assert.equal(readFileSync(join(artifactRoot, "look-2.txt"), "utf8"), "after move\n");
});

void test("look diff compares full output, ignores footer chrome, and reuses the split", async (t) => {
	const { tool, execCalls, artifactRoot } = createExecHarness([
		splitResponse(),
		{
			stdout:
				"alpha\n────────────────\nbranch note\n\nG.\n\n────────────────\n\n────────────────\n/path\nstatus\n",
		},
		{
			stdout:
				"alpha\n────────────────\nbranch note\n\nG.\n\nH prompt\n\n ⠴ Working...\n\n────────────────\n\n────────────────\n/path\nstatus\n",
		},
		{
			stdout:
				"alpha\n────────────────\nbranch note\n\nG.\n\nH prompt\n\nH.\n\n────────────────\n\n────────────────\n/path\nstatus\n",
		},
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const first = await runTool(tool, { action: "look" });
	const firstText = first.content[0]?.type === "text" ? first.content[0].text : "";
	assert.match(firstText, /alpha/);
	assert.equal(existsSync(join(artifactRoot, "look-1.txt")), true);

	const second = await runTool(tool, { action: "look" });
	const secondText = second.content[0]?.type === "text" ? second.content[0].text : "";
	assert.match(secondText, /@@ line 7/);
	assert.match(secondText, /\+ H prompt/);
	assert.doesNotMatch(secondText, /Working/);

	const third = await runTool(tool, { action: "look" });
	const thirdText = third.content[0]?.type === "text" ? third.content[0].text : "";
	assert.match(thirdText, /@@ line 9/);
	assert.match(thirdText, /\+ H\./);
	assert.equal(execCalls.filter((call) => call.args[0] === "new-split").length, 1);
});

void test("look diff keeps raw tty output changes when footer chrome is overwritten", async (t) => {
	const { tool, artifactRoot } = createExecHarness([
		splitResponse(),
		{
			stdout:
				"\n────────────────────────────────────────────────────────────────────────────────\n\n────────────────────────────────────────────────────────────────────────────────\n/project\n0.0%/205k (auto)                       (opencode-go) minimax-m2.7 • thinking off\n",
		},
		{
			stdout:
				"\n────────────────────────────────────────────────────────────────────────────────\nZ001\nZ002────────────────────────────────────────────────────────────────────────────\nZ003oject\nZ004/205k (auto)                       (opencode-go) minimax-m2.7 • thinking off\nZ005\nZ006\n",
		},
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	await runTool(tool, { action: "look" });
	const second = await runTool(tool, { action: "look" });
	const text = second.content[0]?.type === "text" ? second.content[0].text : "";

	assert.doesNotMatch(text, /No output changes\./);
	assert.match(text, /\+ Z001/);
	assert.match(text, /\+ Z006/);
	assert.equal(readFileSync(join(artifactRoot, "look-2.txt"), "utf8"),
		"\n────────────────────────────────────────────────────────────────────────────────\nZ001\nZ002────────────────────────────────────────────────────────────────────────────\nZ003oject\nZ004/205k (auto)                       (opencode-go) minimax-m2.7 • thinking off\nZ005\nZ006\n");
});

void test("look last returns compact tail from full output and saves full-output artifact", async (t) => {
	const { tool, artifactRoot } = createExecHarness([
		splitResponse(),
		{ stdout: "\nhistory\nfirst\n\nsecond\nthird\n" },
	]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	const result = await runTool(tool, { action: "look", mode: "last", lines: 2 });
	const text = result.content[0]?.type === "text" ? result.content[0].text : "";

	assert.equal(text, "second\nthird");
	assert.equal(readFileSync(join(artifactRoot, "look-1.txt"), "utf8"),
		"\nhistory\nfirst\n\nsecond\nthird\n");
});

void test("do maps literal text, key names, and enter to cmux surface input", async (t) => {
	const { tool, execCalls, artifactRoot } = createExecHarness([
		splitResponse(),
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

	assertCmuxArgs(execCalls, [
		splitArgs("origin"),
		sendArgs("send", "attached", "/reload"),
		sendArgs("send-key", "attached", "escape"),
		sendArgs("send", "attached", "[Z"),
		sendArgs("send-key", "attached", "enter"),
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

void test("renderCall shows full pp args in the title", (t) => {
	const { tool, artifactRoot } = createExecHarness([]);
	t.after(() => rmSync(artifactRoot, { recursive: true, force: true }));

	assert.deepEqual(renderCallText(tool, { action: "look", mode: "last", lines: 5 }), [
		"pp action=look mode=last lines=5",
	]);
	assert.deepEqual(renderCallText(tool, {
		action: "do",
		text: "/reload",
		keys: ["Escape", "[", "Z"],
		enter: true,
	}), [
		"pp action=do text=\"/reload\" keys=[\"Escape\",\"[\",\"Z\"] enter=true",
	]);
});
