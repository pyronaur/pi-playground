import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
	BeforeProviderRequestEvent,
	ExtensionCommandContext,
	ExtensionContext,
	SessionStartEvent,
	TurnStartEvent,
} from "@mariozechner/pi-coding-agent";

type NotifyType = "info" | "warning" | "error";

type AuthInfo = {
	apiKey: string | undefined;
	headers: Record<string, string> | undefined;
};

type DebugRecord =
	| {
		type: "debug_active" | "debug_enabled";
		timestamp: string;
		cwd: string;
		reason: string | undefined;
		sessionFile: string | undefined;
		requestsFile: string;
	}
	| {
		type: "before_provider_request";
		timestamp: string;
		cwd: string;
		sessionFile: string | undefined;
		requestsFile: string;
		turn: number;
		model: string;
		api: string | undefined;
		baseUrl: string | undefined;
		auth: AuthInfo | undefined;
		payloadBytes: number;
		payload: unknown;
	};

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

function formatClock(date: Date): string {
	return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatFileStamp(date: Date): string {
	return [
		date.getFullYear(),
		pad2(date.getMonth() + 1),
		pad2(date.getDate()),
		"-",
		pad2(date.getHours()),
		pad2(date.getMinutes()),
		pad2(date.getSeconds()),
	].join("");
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function maskSecret(value: string | undefined): string | undefined {
	if (!value) return value;
	if (value.length <= 8) return "*".repeat(value.length);
	return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function redactHeaders(
	headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!headers) return undefined;

	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		const lower = key.toLowerCase();
		if (lower.includes("authorization") || lower.includes("api-key") || lower.includes("token")) {
			result[key] = maskSecret(value) ?? value;
			continue;
		}

		result[key] = value;
	}

	return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getString(value: unknown, key: string): string | undefined {
	if (!isObject(value)) return undefined;
	const item = value[key];
	return typeof item === "string" ? item : undefined;
}

function getArray(value: unknown, key: string): unknown[] | undefined {
	if (!isObject(value)) return undefined;
	const item = value[key];
	return Array.isArray(item) ? item : undefined;
}

type DebugCtx = Pick<
	ExtensionContext,
	"cwd" | "hasUI" | "ui" | "model" | "modelRegistry" | "sessionManager"
>;

type DebugCommandCtx = Pick<ExtensionCommandContext, "cwd" | "hasUI" | "ui" | "sessionManager">;

export type RequestDebuggerToggleResult = {
	enabled: boolean;
	logPath: string | undefined;
};

export class RequestDebugger {
	readonly name: string;
	private enabled = false;
	private turn = 0;
	private logPath: string | undefined;

	constructor(name = "provider-request") {
		this.name = name;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	getLogPath(): string | undefined {
		return this.logPath;
	}

	onSessionStart(enabled: boolean, event: SessionStartEvent, ctx: DebugCtx): void {
		this.enabled = enabled;
		this.turn = 0;
		this.logPath = undefined;

		if (!this.enabled) return;

		const date = new Date();
		const path = this.ensureLogPath(ctx, date);
		this.appendRecord(path, {
			type: "debug_active",
			timestamp: date.toISOString(),
			cwd: ctx.cwd,
			reason: event.reason,
			sessionFile: ctx.sessionManager.getSessionFile(),
			requestsFile: path,
		});
		this.notify(ctx, `playground request debug active -> ${path}`);
	}

	onSessionShutdown(): void {
		this.enabled = false;
		this.turn = 0;
		this.logPath = undefined;
	}

	onTurnStart(event: TurnStartEvent): void {
		this.turn = event.turnIndex;
	}

	setEnabled(enabled: boolean, ctx: DebugCommandCtx): RequestDebuggerToggleResult {
		this.enabled = enabled;
		this.turn = 0;

		if (!enabled) {
			const path = this.logPath;
			this.logPath = undefined;
			this.notify(ctx,
				path ? `playground request debug off (${path})` : "playground request debug off");
			return { enabled: false, logPath: path };
		}

		const date = new Date();
		const path = this.ensureLogPath(ctx, date);
		this.appendRecord(path, {
			type: "debug_enabled",
			timestamp: date.toISOString(),
			cwd: ctx.cwd,
			reason: undefined,
			sessionFile: ctx.sessionManager.getSessionFile(),
			requestsFile: path,
		});
		this.notify(ctx, `playground request debug on -> ${path}`);
		return { enabled: true, logPath: path };
	}

	async recordBeforeProviderRequest(
		event: BeforeProviderRequestEvent,
		ctx: DebugCtx,
	): Promise<void> {
		if (!this.enabled) return;

		const date = new Date();
		const path = this.ensureLogPath(ctx, date);
		const payloadText = JSON.stringify(event.payload);
		const payloadBytes = Buffer.byteLength(payloadText, "utf8");
		const model = ctx.model;
		const modelLabel = model ? `${model.provider}/${model.id}` : "unknown-model";
		const notifyText = this.extractNotifyText(event.payload)
			?? `${modelLabel} ${formatBytes(payloadBytes)}`;

		let authInfo: AuthInfo | undefined;
		if (model) {
			try {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (auth.ok) {
					authInfo = {
						apiKey: maskSecret(auth.apiKey),
						headers: redactHeaders(auth.headers as Record<string, string> | undefined),
					};
				}
			} catch {
				authInfo = undefined;
			}
		}

		this.appendRecord(path, {
			type: "before_provider_request",
			timestamp: date.toISOString(),
			cwd: ctx.cwd,
			sessionFile: ctx.sessionManager.getSessionFile(),
			requestsFile: path,
			turn: this.turn,
			model: modelLabel,
			api: model?.api,
			baseUrl: model?.baseUrl,
			auth: authInfo,
			payloadBytes,
			payload: event.payload,
		});
		this.notify(ctx, this.clip(notifyText, 160));
	}

	private ensureLogPath(ctx: Pick<DebugCtx, "cwd" | "sessionManager">, date: Date): string {
		if (this.logPath) return this.logPath;

		const sessionFile = ctx.sessionManager.getSessionFile();
		this.logPath = sessionFile
			? this.makeSessionLogPath(sessionFile)
			: this.makeFallbackLogPath(ctx.cwd, date);
		mkdirSync(dirname(this.logPath), { recursive: true });
		return this.logPath;
	}

	private makeSessionLogPath(sessionFile: string): string {
		if (sessionFile.endsWith(".jsonl")) {
			return sessionFile.replace(/\.jsonl$/, ".requests.jsonl");
		}

		return `${sessionFile}.requests.jsonl`;
	}

	private makeFallbackLogPath(cwd: string, date: Date): string {
		return join(cwd, ".pi", "playground", `${this.name}-${formatFileStamp(date)}.requests.jsonl`);
	}

	private appendRecord(path: string, record: DebugRecord): void {
		appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
	}

	private notify(
		ctx: Pick<DebugCtx, "hasUI" | "ui">,
		message: string,
		type: NotifyType = "info",
	): void {
		if (!ctx.hasUI) return;
		ctx.ui.notify(`${formatClock(new Date())} ${message}`, type);
	}

	private clip(text: string, max = 140): string {
		const oneLine = text.replace(/\s+/g, " ").trim();
		if (oneLine.length <= max) return oneLine;
		return `${oneLine.slice(0, max - 1)}…`;
	}

	private extractNotifyText(payload: unknown): string | undefined {
		const inputText = this.extractFromInputArray(getArray(payload, "input"));
		if (inputText) return inputText;

		const messageText = this.extractFromMessageArray(getArray(payload, "messages"));
		if (messageText) return messageText;

		return this.extractLastText(payload);
	}

	private extractFromInputArray(input: unknown[] | undefined): string | undefined {
		if (!input) return undefined;

		for (let i = input.length - 1; i >= 0; i--) {
			const item = input[i];
			if (getString(item, "role") !== "user") continue;
			const text = this.extractFromContent(isObject(item) ? item.content : undefined);
			if (text) return text;
		}

		return undefined;
	}

	private extractFromMessageArray(messages: unknown[] | undefined): string | undefined {
		if (!messages) return undefined;

		for (let i = messages.length - 1; i >= 0; i--) {
			const item = messages[i];
			if (getString(item, "role") !== "user") continue;
			const text = this.extractFromContent(isObject(item) ? item.content : undefined);
			if (text) return text;
		}

		return undefined;
	}

	private extractFromContent(content: unknown): string | undefined {
		if (typeof content === "string") return this.clip(content, 160);
		if (!Array.isArray(content)) return undefined;

		for (let i = content.length - 1; i >= 0; i--) {
			const item = content[i];
			if (!item) continue;
			if (typeof item === "string") {
				const text = this.clip(item, 160);
				if (text) return text;
				continue;
			}
			const text = getString(item, "text") ?? getString(item, "input_text");
			if (text) return this.clip(text, 160);
		}

		return undefined;
	}

	private extractLastText(value: unknown): string | undefined {
		const texts: string[] = [];
		this.collectTexts(value, texts, 0);
		return texts.length > 0 ? texts[texts.length - 1] : undefined;
	}

	private collectTexts(value: unknown, texts: string[], depth: number): void {
		if (depth > 6 || texts.length >= 20 || value == null) return;

		if (typeof value === "string") {
			const text = this.clip(value, 220);
			if (text) texts.push(text);
			return;
		}

		if (Array.isArray(value)) {
			for (const item of value) {
				this.collectTexts(item, texts, depth + 1);
				if (texts.length >= 20) return;
			}
			return;
		}

		if (!isObject(value)) return;

		const candidateKeys = [
			"text",
			"input_text",
			"content",
			"input",
			"messages",
			"prompt",
			"instructions",
		];
		for (const key of candidateKeys) {
			if (!(key in value)) continue;
			this.collectTexts(value[key], texts, depth + 1);
			if (texts.length >= 20) return;
		}
	}
}
