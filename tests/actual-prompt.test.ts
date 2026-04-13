import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	captureActualPrompt,
	extractActualPrompt,
	getActualPromptPath,
	readActualPrompt,
} from "../src/modules/actual-prompt.ts";

void test("extractActualPrompt reads responses instructions payload", () => {
	assert.deepEqual(extractActualPrompt({ instructions: "full prompt" }), {
		content: "full prompt",
		source: "payload.instructions",
	});
});

void test("extractActualPrompt reads anthropic-style system payload", () => {
	assert.deepEqual(extractActualPrompt({
		system: [{ type: "text", text: "system one" }, { type: "text", text: "system two" }],
	}), {
		content: "system one\n\nsystem two",
		source: "payload.system",
	});
});

void test("extractActualPrompt reads system and developer messages", () => {
	assert.deepEqual(extractActualPrompt({
		messages: [
			{ role: "system", content: [{ type: "text", text: "system prompt" }] },
			{ role: "developer", content: "dev prompt" },
			{ role: "user", content: "user prompt" },
		],
	}), {
		content: "system prompt\n\ndev prompt",
		source: "payload.messages",
	});
});

void test("captureActualPrompt writes session-adjacent prompt file", () => {
	const cwd = mkdtempSync(join(tmpdir(), "actual-prompt-"));
	const sessionFile = join(cwd, "session.jsonl");
	const path = getActualPromptPath(sessionFile, cwd);

	const capture = captureActualPrompt(
		{ type: "before_provider_request", payload: { instructions: "wire truth" } },
		{
			cwd,
			sessionManager: {
				getSessionFile() {
					return sessionFile;
				},
			},
		} as never,
	);

	assert.equal(capture?.path, path);
	assert.equal(readFileSync(path, "utf8"), "wire truth");
	assert.deepEqual(readActualPrompt(sessionFile, cwd), {
		content: "wire truth",
		source: "captured wire payload",
		path,
	});

	rmSync(cwd, { recursive: true, force: true });
});
