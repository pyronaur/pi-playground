import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
	type ExtensionContext,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";

import {
	type ActualPromptCapture,
	captureActualPrompt,
	getActualPromptPath,
} from "./actual-prompt.ts";
import { getAgentDir } from "./agent-dir.ts";
import {
	discoverPromptFile,
	loadProjectContextFiles,
	type PromptFileSource,
} from "./prompt-files.ts";

type TraceCtx = Pick<ExtensionContext, "cwd" | "getSystemPrompt" | "sessionManager">;

type PromptToolSource = {
	name: string;
	sourcePath?: string;
	description?: string;
};

type PromptSourceManifest = {
	version: 1;
	capturedAt: string;
	cwd: string;
	sessionId: string;
	agentDir: string;
	systemPromptFile?: PromptFileSource;
	appendSystemPromptFiles: PromptFileSource[];
	contextFiles: Array<{ path: string }>;
	activeTools: PromptToolSource[];
	activeToolCount: number;
	totalToolCount: number;
	effectivePromptPath: string;
	actualPromptPath?: string;
	actualPromptSource?: string;
	providerResponsePath: string;
	notes: string[];
};

type ProviderResponseCapture = {
	status: number;
	headers: Record<string, string>;
	path: string;
};

type PromptTracePaths = {
	actualPrompt: string;
	effectivePrompt: string;
	sources: string;
	providerResponse: string;
};

type PromptTraceOptions = {
	activeToolNames: string[];
	allTools: ToolInfo[];
};

type AfterProviderResponseLike = {
	status: number;
	headers: Record<string, string>;
};

function getTracePath(
	sessionFile: string | undefined,
	cwd: string,
	suffix: string,
	fallbackName: string,
): string {
	if (sessionFile?.endsWith(".jsonl")) {
		return sessionFile.replace(/\.jsonl$/, suffix);
	}

	if (sessionFile) {
		return `${sessionFile}${suffix}`;
	}

	return join(cwd, ".pi", "playground", fallbackName);
}

export function getPromptTracePaths(
	sessionFile: string | undefined,
	cwd: string,
): PromptTracePaths {
	return {
		actualPrompt: getActualPromptPath(sessionFile, cwd),
		effectivePrompt: getTracePath(
			sessionFile,
			cwd,
			".effective-system-prompt.txt",
			"effective-system-prompt.txt",
		),
		sources: getTracePath(sessionFile, cwd, ".prompt-sources.json", "prompt-sources.json"),
		providerResponse: getTracePath(
			sessionFile,
			cwd,
			".provider-response.json",
			"provider-response.json",
		),
	};
}

function writeText(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf8");
}

function writeJson(path: string, value: unknown): void {
	writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function buildActiveToolSources(options: PromptTraceOptions): PromptToolSource[] {
	const active = new Set(options.activeToolNames);
	const tools = options.allTools.filter((tool) => active.has(tool.name));
	tools.sort((left, right) => {
		return options.activeToolNames.indexOf(left.name) - options.activeToolNames.indexOf(right.name);
	});

	return tools.map((tool) => {
		const source: PromptToolSource = { name: tool.name };
		if (tool.sourceInfo?.path) {
			source.sourcePath = tool.sourceInfo.path;
		}
		if (tool.description) {
			source.description = tool.description;
		}
		return source;
	});
}

export function capturePromptTrace(
	event: { payload: unknown },
	ctx: TraceCtx,
	options: PromptTraceOptions,
): { actualPrompt?: ActualPromptCapture; sources: PromptSourceManifest; paths: PromptTracePaths } {
	const sessionFile = ctx.sessionManager.getSessionFile();
	const paths = getPromptTracePaths(sessionFile, ctx.cwd);
	const effectivePrompt = ctx.getSystemPrompt();
	writeText(paths.effectivePrompt, effectivePrompt);

	const actualPrompt = captureActualPrompt(
		{ type: "before_provider_request", payload: event.payload },
		ctx as never,
	);

	const agentDir = getAgentDir();
	const systemPromptFile = discoverPromptFile(ctx.cwd, agentDir, "SYSTEM.md");
	const appendPromptFile = discoverPromptFile(ctx.cwd, agentDir, "APPEND_SYSTEM.md");
	const activeTools = buildActiveToolSources(options);
	const sources: PromptSourceManifest = {
		version: 1,
		capturedAt: new Date().toISOString(),
		cwd: ctx.cwd,
		sessionId: ctx.sessionManager.getSessionId(),
		agentDir,
		appendSystemPromptFiles: appendPromptFile ? [appendPromptFile] : [],
		contextFiles: loadProjectContextFiles(ctx.cwd, agentDir).map((file) => ({
			path: file.path,
		})),
		activeTools,
		activeToolCount: activeTools.length,
		totalToolCount: options.allTools.length,
		effectivePromptPath: paths.effectivePrompt,
		providerResponsePath: paths.providerResponse,
		notes: [
			"This manifest only records prompt inputs discoverable from extension context.",
			"Inline or CLI --append-system-prompt values are visible in the effective prompt snapshot, not as file-backed sources here.",
		],
	};
	if (systemPromptFile) {
		sources.systemPromptFile = systemPromptFile;
	}
	if (actualPrompt?.path) {
		sources.actualPromptPath = actualPrompt.path;
	}
	if (actualPrompt?.source) {
		sources.actualPromptSource = actualPrompt.source;
	}

	writeJson(paths.sources, sources);
	const capture: {
		actualPrompt?: ActualPromptCapture;
		sources: PromptSourceManifest;
		paths: PromptTracePaths;
	} = {
		sources,
		paths,
	};
	if (actualPrompt) {
		capture.actualPrompt = actualPrompt;
	}
	return capture;
}

export function captureProviderResponse(
	event: AfterProviderResponseLike,
	ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
): ProviderResponseCapture {
	const path = getPromptTracePaths(ctx.sessionManager.getSessionFile(), ctx.cwd).providerResponse;
	const capture = {
		capturedAt: new Date().toISOString(),
		sessionId: ctx.sessionManager.getSessionId(),
		status: event.status,
		headers: event.headers,
	};
	writeJson(path, capture);
	return {
		status: event.status,
		headers: event.headers,
		path,
	};
}

function readJson<T>(path: string): T | undefined {
	if (!existsSync(path)) {
		return undefined;
	}

	return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function readPromptSources(
	sessionFile: string | undefined,
	cwd: string,
): PromptSourceManifest | undefined {
	return readJson<PromptSourceManifest>(getPromptTracePaths(sessionFile, cwd).sources);
}

export function readEffectivePrompt(
	sessionFile: string | undefined,
	cwd: string,
): { content: string; path: string } | undefined {
	const path = getPromptTracePaths(sessionFile, cwd).effectivePrompt;
	if (!existsSync(path)) {
		return undefined;
	}

	return {
		content: readFileSync(path, "utf8"),
		path,
	};
}

export function readProviderResponse(
	sessionFile: string | undefined,
	cwd: string,
): ProviderResponseCapture | undefined {
	const path = getPromptTracePaths(sessionFile, cwd).providerResponse;
	const capture = readJson<{ status: number; headers: Record<string, string> }>(path);
	if (!capture) {
		return undefined;
	}

	return {
		status: capture.status,
		headers: capture.headers,
		path,
	};
}
