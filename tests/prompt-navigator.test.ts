import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	createPromptNavigatorData,
	getExternalEditorCommandForTest,
	getPromptNavigatorLayout,
} from "../src/modules/prompt-navigator.ts";

void test("createPromptNavigatorData includes effective prompt, file-backed sources, and active tools", () => {
	const root = mkdtempSync(join(tmpdir(), "prompt-nav-"));
	const agentDir = join(root, "agent");
	const repo = join(root, "repo");
	const cwd = repo;

	mkdirSync(join(agentDir), { recursive: true });
	mkdirSync(cwd, { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });

	const globalAgents = join(agentDir, "AGENTS.md");
	const systemPath = join(cwd, ".pi", "SYSTEM.md");
	const appendPath = join(cwd, ".pi", "APPEND_SYSTEM.md");
	const repoAgents = join(repo, "AGENTS.md");

	writeFileSync(globalAgents, "global agents\n", "utf8");
	writeFileSync(systemPath, "custom system\n", "utf8");
	writeFileSync(appendPath, "append system\n", "utf8");
	writeFileSync(repoAgents, "repo agents\n", "utf8");

	const fullPrompt = [
		"custom system",
		"",
		"append system",
		"",
		"# Project Context",
		"",
		"Project-specific instructions and guidelines:",
		"",
		`## ${globalAgents}`,
		"",
		"global agents",
		"",
		`## ${repoAgents}`,
		"",
		"repo agents",
		"",
		"The following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
		"<available_skills>",
		"  <skill>",
		"    <name>demo</name>",
		"    <description>demo skill</description>",
		"    <location>/tmp/demo/SKILL.md</location>",
		"  </skill>",
		"</available_skills>",
		"Current date: 2026-04-12",
		`Current working directory: ${cwd}`,
	].join("\n");

	const data = createPromptNavigatorData(
		{
			cwd,
			getSystemPrompt() {
				return fullPrompt;
			},
		},
		{
			agentDir,
			activeToolNames: ["read", "piux_client"],
			allTools: [
				{
					name: "read",
					description: "Read files",
					parameters: { type: "object" },
					sourceInfo: { path: "/tools/read.ts" },
				},
				{
					name: "piux_client",
					description: "Drive piux",
					parameters: { type: "object" },
					sourceInfo: { path: "/tools/piux.ts" },
				},
				{
					name: "bash",
					description: "Run bash",
					parameters: { type: "object" },
					sourceInfo: { path: "/tools/bash.ts" },
				},
			],
		},
	);

	assert.equal(data.systemItems[0]?.id, "effective-system-prompt");
	assert.equal(data.systemItems.some((item) => item.path === systemPath), true);
	assert.equal(data.systemItems.some((item) => item.path === appendPath), true);
	assert.equal(data.systemItems.some((item) => item.path === globalAgents), true);
	assert.equal(data.systemItems.some((item) => item.path === repoAgents), true);
	assert.equal(data.systemItems.some((item) => item.id === "skills-block"), true);
	assert.equal(data.systemItems.some((item) => item.id === "runtime-footer"), true);
	assert.deepEqual(data.toolItems.map((item) => item.id), ["tool:read", "tool:piux_client"]);

	rmSync(root, { recursive: true, force: true });
});

void test("createPromptNavigatorData adds built-in base section when no SYSTEM.md exists", () => {
	const root = mkdtempSync(join(tmpdir(), "prompt-nav-base-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "repo");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });

	const data = createPromptNavigatorData(
		{
			cwd,
			getSystemPrompt() {
				return [
					"built in base",
					"",
					"Current date: 2026-04-12",
					`Current working directory: ${cwd}`,
				].join("\n");
			},
		},
		{ agentDir },
	);

	assert.equal(data.systemItems.some((item) => item.id === "built-in-base"), true);

	rmSync(root, { recursive: true, force: true });
});

void test("getExternalEditorCommandForTest splits VISUAL args", () => {
	assert.deepEqual(getExternalEditorCommandForTest({ VISUAL: "zed --wait" } as never), {
		command: "zed",
		args: ["--wait"],
	});
	assert.equal(getExternalEditorCommandForTest({} as never), undefined);
});

void test("getPromptNavigatorLayout keeps split rows aligned to the popup frame", () => {
	const layout = getPromptNavigatorLayout(120, 2);
	assert.equal(layout.rowWidth, 120);
	assert.equal(layout.contentPadding, 2);
	assert.equal(layout.listWidth + layout.bodyWidth + 3, 120);
});
