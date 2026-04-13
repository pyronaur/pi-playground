import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { BeforeProviderRequestEvent, ExtensionContext } from "@mariozechner/pi-coding-agent";

export type ActualPromptCapture = {
	content: string;
	source: string;
	path?: string;
};

type PromptCtx = Pick<ExtensionContext, "cwd" | "sessionManager">;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getString(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const item = value[key];
	return typeof item === "string" ? item : undefined;
}

function getArray(value: unknown, key: string): unknown[] | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const item = value[key];
	return Array.isArray(item) ? item : undefined;
}

function normalizePrompt(text: string): string {
	return text.replace(/\r\n/g, "\n").trim();
}

function extractText(value: unknown): string | undefined {
	if (typeof value === "string") {
		const text = normalizePrompt(value);
		return text.length > 0 ? text : undefined;
	}

	if (Array.isArray(value)) {
		const parts = value.map((item) => extractText(item)).filter((item) => item !== undefined);
		if (parts.length === 0) {
			return undefined;
		}

		return parts.join("\n\n");
	}

	if (!isRecord(value)) {
		return undefined;
	}

	const direct = getString(value, "text") ?? getString(value, "input_text")
		?? getString(value, "content");
	if (direct) {
		return normalizePrompt(direct);
	}

	for (const key of ["content", "parts", "value"]) {
		const text = extractText(value[key]);
		if (text) {
			return text;
		}
	}

	return undefined;
}

function extractRolePrompts(items: unknown[] | undefined): string | undefined {
	if (!items) {
		return undefined;
	}

	const parts: string[] = [];
	for (const item of items) {
		if (!isRecord(item)) {
			continue;
		}

		const role = getString(item, "role");
		if (role !== "system" && role !== "developer") {
			continue;
		}

		const text = extractText(item.content);
		if (!text) {
			continue;
		}

		parts.push(text);
	}

	if (parts.length === 0) {
		return undefined;
	}

	return parts.join("\n\n");
}

export function extractActualPrompt(payload: unknown): ActualPromptCapture | undefined {
	if (!isRecord(payload)) {
		return undefined;
	}

	const instructions = getString(payload, "instructions");
	if (instructions) {
		return { content: normalizePrompt(instructions), source: "payload.instructions" };
	}

	const system = extractText(payload.system);
	if (system) {
		return { content: system, source: "payload.system" };
	}

	const systemInstruction = extractText(payload.systemInstruction);
	if (systemInstruction) {
		return { content: systemInstruction, source: "payload.systemInstruction" };
	}

	const messagePrompt = extractRolePrompts(getArray(payload, "messages"));
	if (messagePrompt) {
		return { content: messagePrompt, source: "payload.messages" };
	}

	const inputPrompt = extractRolePrompts(getArray(payload, "input"));
	if (inputPrompt) {
		return { content: inputPrompt, source: "payload.input" };
	}

	return undefined;
}

export function getActualPromptPath(sessionFile: string | undefined, cwd: string): string {
	if (sessionFile?.endsWith(".jsonl")) {
		return sessionFile.replace(/\.jsonl$/, ".system-prompt.txt");
	}

	if (sessionFile) {
		return `${sessionFile}.system-prompt.txt`;
	}

	return join(cwd, ".pi", "playground", "system-prompt.txt");
}

export function captureActualPrompt(
	event: BeforeProviderRequestEvent,
	ctx: PromptCtx,
): ActualPromptCapture | undefined {
	const prompt = extractActualPrompt(event.payload);
	if (!prompt) {
		return undefined;
	}

	const path = getActualPromptPath(ctx.sessionManager.getSessionFile(), ctx.cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, prompt.content, "utf8");
	return { ...prompt, path };
}

export function readActualPrompt(
	sessionFile: string | undefined,
	cwd: string,
): ActualPromptCapture | undefined {
	const path = getActualPromptPath(sessionFile, cwd);
	if (!existsSync(path)) {
		return undefined;
	}

	const content = normalizePrompt(readFileSync(path, "utf8"));
	if (content.length === 0) {
		return undefined;
	}

	return {
		content,
		source: "captured wire payload",
		path,
	};
}
