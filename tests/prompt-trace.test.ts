import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	capturePromptTrace,
	captureProviderResponse,
	getPromptTracePaths,
	readEffectivePrompt,
	readPromptSources,
	readProviderResponse,
} from "../src/modules/prompt-trace.ts";

function withAgentDir<T>(agentDir: string, run: () => T): T {
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		return run();
	} finally {
		if (previous === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
			return;
		}

		process.env.PI_CODING_AGENT_DIR = previous;
	}
}

void test("capturePromptTrace writes effective prompt, actual prompt, and source manifest", () => {
	const root = mkdtempSync(join(tmpdir(), "prompt-trace-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "repo");
	const sessionFile = join(cwd, "session.jsonl");
	const globalAgents = join(agentDir, "AGENTS.md");
	const repoAgents = join(cwd, "AGENTS.md");
	const systemPath = join(cwd, ".pi", "SYSTEM.md");
	const appendPath = join(cwd, ".pi", "APPEND_SYSTEM.md");

	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(globalAgents, "global agents\n", "utf8");
	writeFileSync(repoAgents, "repo agents\n", "utf8");
	writeFileSync(systemPath, "project system\n", "utf8");
	writeFileSync(appendPath, "project append\n", "utf8");

	withAgentDir(agentDir, () => {
		const trace = capturePromptTrace(
			{ payload: { instructions: "wire truth" } },
			{
				cwd,
				getSystemPrompt() {
					return "effective prompt";
				},
				sessionManager: {
					getSessionFile() {
						return sessionFile;
					},
					getSessionId() {
						return "session-123";
					},
				},
			} as never,
			{
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
				],
			},
		);

		const paths = getPromptTracePaths(sessionFile, cwd);
		assert.equal(trace.paths.effectivePrompt, paths.effectivePrompt);
		assert.equal(readFileSync(paths.effectivePrompt, "utf8"), "effective prompt");
		assert.equal(readFileSync(paths.actualPrompt, "utf8"), "wire truth");

		const effective = readEffectivePrompt(sessionFile, cwd);
		assert.deepEqual(effective, {
			content: "effective prompt",
			path: paths.effectivePrompt,
		});

		const sources = readPromptSources(sessionFile, cwd);
		assert.ok(sources);
		assert.equal(sources?.systemPromptFile?.path, systemPath);
		assert.equal(sources?.appendSystemPromptFiles[0]?.path, appendPath);
		assert.deepEqual(sources?.contextFiles.map((item) => item.path), [globalAgents, repoAgents]);
		assert.equal(sources?.actualPromptPath, paths.actualPrompt);
		assert.equal(sources?.actualPromptSource, "payload.instructions");
		assert.equal(sources?.effectivePromptPath, paths.effectivePrompt);
		assert.equal(sources?.providerResponsePath, paths.providerResponse);
		assert.deepEqual(sources?.activeTools.map((item) => item.name), ["read", "piux_client"]);
		assert.equal(sources?.activeToolCount, 2);
		assert.equal(sources?.totalToolCount, 2);
	});

	rmSync(root, { recursive: true, force: true });
});

void test("captureProviderResponse writes response metadata sidecar", () => {
	const cwd = mkdtempSync(join(tmpdir(), "prompt-response-"));
	const sessionFile = join(cwd, "session.jsonl");
	const paths = getPromptTracePaths(sessionFile, cwd);

	const capture = captureProviderResponse(
		{
			type: "after_provider_response",
			status: 201,
			headers: { "x-request-id": "abc", "retry-after": "3" },
		},
		{
			cwd,
			sessionManager: {
				getSessionFile() {
					return sessionFile;
				},
				getSessionId() {
					return "session-123";
				},
			},
		} as never,
	);

	assert.equal(capture.path, paths.providerResponse);
	const response = readProviderResponse(sessionFile, cwd);
	assert.deepEqual(response, {
		status: 201,
		headers: { "x-request-id": "abc", "retry-after": "3" },
		path: paths.providerResponse,
	});

	rmSync(cwd, { recursive: true, force: true });
});
