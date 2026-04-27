import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

import {
	PLAYGROUND_EXPOSURE_TYPE,
	PlaygroundExposureMessage,
} from "../models/playground-exposure-message.ts";
import {
	PLAYGROUND_STATE_TYPE,
	PlaygroundSessionState,
} from "../models/playground-session-state.ts";
import { PpTool } from "../modules/pp-tool.ts";
import { PromptNavigator } from "../modules/prompt-navigator.ts";
import { capturePromptTrace, captureProviderResponse } from "../modules/prompt-trace.ts";
import { RequestDebugger } from "../modules/request-debugger.ts";

import { isPiLeaderOpenEvent } from "./pi-leader-event.ts";
import { clearPlaygroundWidget, syncPlaygroundWidget } from "./widget.ts";

type AfterProviderResponseEvent = {
	status: number;
	headers: Record<string, string>;
};

type PlayScratchModule = {
	default?: (pi: ExtensionAPI, options: { isActive(): boolean }) => void;
};

function onAfterProviderResponse(
	pi: ExtensionAPI,
	handler: (event: AfterProviderResponseEvent, ctx: ExtensionContext) => void,
): void {
	(pi as ExtensionAPI & {
		on(name: string, handler: (event: unknown, ctx: ExtensionContext) => void): void;
	}).on("after_provider_response", handler as never);
}

function getRequestLoggingLabel(state: PlaygroundSessionState): string {
	return state.requestLogging ? "toggle request logging (on)" : "toggle request logging";
}

function getExposureLines(message: PlaygroundExposureMessage): string[] {
	return [
		message.title,
		`Session ID: ${message.sessionId}`,
		`Session file: ${message.sessionFile}`,
		`Runbook: ${message.runbook}`,
	];
}

export function registerPlayground(pi: ExtensionAPI) {
	const ppTool = new PpTool(pi);
	const promptNavigator = new PromptNavigator(pi);
	const requestDebugger = new RequestDebugger();
	let ctx: ExtensionContext | undefined;
	let state = PlaygroundSessionState.inactive();
	let offLeader: (() => void) | undefined;
	let playScratchLoaded = false;
	pi.registerTool(ppTool.definition);
	pi.registerMessageRenderer(PLAYGROUND_EXPOSURE_TYPE, (message, { expanded }, theme) => {
		const exposure = PlaygroundExposureMessage.fromUnknown(message.details);
		const lines = exposure
			? getExposureLines(exposure)
			: [typeof message.content === "string" ? message.content : PLAYGROUND_EXPOSURE_TYPE];
		const visibleLines = expanded || lines.length <= 3
			? lines
			: [...lines.slice(0, 3), "..."];
		const styled = visibleLines.map((line, index) => {
			const color = index === 0 ? "customMessageLabel" : "customMessageText";
			const text = index === 0 ? theme.bold(line) : line;
			return theme.fg(color, text);
		}).join("\n");

		const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
		box.addChild(new Text(styled, 0, 0));
		return box;
	});

	function syncUi(): void {
		if (!ctx?.hasUI) {
			return;
		}

		syncPlaygroundWidget(ctx, state);
	}

	async function ensurePlayScratch(): Promise<void> {
		if (playScratchLoaded) {
			return;
		}
		playScratchLoaded = true;
		try {
			const scratchUrl = new URL("../play/prompt-flow-scratch.js", import.meta.url).href;
			const module = await import(scratchUrl) as PlayScratchModule;
			module.default?.(pi, { isActive: () => state.active });
		} catch (error) {
			playScratchLoaded = false;
			const message = error instanceof Error ? error.message : String(error);
			ctx?.ui.notify(`play scratch failed: ${message}`, "error");
		}
	}

	function setState(next: PlaygroundSessionState): void {
		const changed = next.active !== state.active || next.requestLogging !== state.requestLogging;
		const activeChanged = next.active !== state.active;
		const requestLoggingChanged = next.requestLogging !== state.requestLogging;
		state = next;
		if (!changed) {
			return;
		}

		if (activeChanged) {
			ppTool.syncActive(state.active);
		}

		pi.appendEntry(PLAYGROUND_STATE_TYPE, state.toData());
		syncUi();
		if (requestLoggingChanged && ctx) {
			requestDebugger.setEnabled(state.requestLogging, ctx);
		}
		if (activeChanged && state.active && ctx) {
			void ensurePlayScratch();
			ensureExposure(ctx);
		}
	}

	function ensureExposure(nextCtx: ExtensionContext): void {
		const branch = nextCtx.sessionManager.getBranch();
		const currentMessage = PlaygroundExposureMessage.create({
			compactionId: PlaygroundExposureMessage.getCompactionId(branch),
			sessionId: nextCtx.sessionManager.getSessionId(),
			sessionFile: nextCtx.sessionManager.getSessionFile(),
		});
		for (const entry of branch) {
			const message = PlaygroundExposureMessage.fromEntry(entry);
			if (!message?.matchesContext(currentMessage)) {
				continue;
			}

			return;
		}

		pi.sendMessage(currentMessage.toMessage(), { triggerTurn: false });
	}

	function activatePlayground(): void {
		setState(state.with({ active: true }));
	}

	function togglePlayground(): void {
		setState(state.with({ active: !state.active }));
	}

	function toggleRequestLogging(): boolean {
		if (!state.active) {
			ctx?.ui.notify("Activate playground first with /playground", "warning");
			return false;
		}

		setState(state.with({ requestLogging: !state.requestLogging }));
		return true;
	}

	async function openPromptNavigator(nextCtx: ExtensionContext | undefined): Promise<boolean> {
		if (!state.active) {
			nextCtx?.ui.notify("Activate playground first with /playground", "warning");
			return false;
		}

		if (!nextCtx?.hasUI) {
			return false;
		}

		await promptNavigator.open(nextCtx);
		return true;
	}

	pi.registerCommand("playground", {
		description: "Toggle playground for this session",
		handler: async (_args, nextCtx) => {
			ctx = nextCtx;
			togglePlayground();
		},
	});

	pi.registerCommand("playground-toggle-request-logging", {
		description: "Toggle playground request logging for this session",
		handler: async (_args, nextCtx) => {
			ctx = nextCtx;
			toggleRequestLogging();
		},
	});

	pi.registerCommand("system-view", {
		description: "Open the playground prompt navigator",
		handler: async (_args, nextCtx) => {
			ctx = nextCtx;
			await openPromptNavigator(nextCtx);
		},
	});

	pi.registerCommand("system-prompt", {
		description: "Open the full system prompt inspector",
		handler: async (_args, nextCtx) => {
			ctx = nextCtx;
			await openPromptNavigator(nextCtx);
		},
	});

	function attachLeader(): void {
		offLeader?.();
		offLeader = pi.events.on("pi-leader", (event) => {
			if (!isPiLeaderOpenEvent(event)) {
				return;
			}

			event.add("g", "playground", ({ openSubmenu }) => {
				if (!state.active) {
					activatePlayground();
					return;
				}

				openSubmenu("playground", [
					{
						key: "p",
						label: "prompt navigator",
						run: async () => {
							await openPromptNavigator(ctx);
						},
					},
					{
						key: "r",
						label: getRequestLoggingLabel(state),
						run: () => {
							toggleRequestLogging();
						},
					},
				]);
			});
		});
	}

	pi.on("session_start", (event, nextCtx) => {
		ctx = nextCtx;
		state = PlaygroundSessionState.load(nextCtx.sessionManager.getEntries());
		ppTool.syncActive(state.active);
		attachLeader();
		syncUi();
		requestDebugger.onSessionStart(state.requestLogging, event, nextCtx);
		if (state.active) {
			void ensurePlayScratch();
			ensureExposure(nextCtx);
		}
	});

	pi.on("session_compact", (_event, nextCtx) => {
		if (!state.active) {
			return;
		}

		ensureExposure(nextCtx);
	});

	pi.on("session_tree", (_event, nextCtx) => {
		if (!state.active) {
			return;
		}

		ensureExposure(nextCtx);
	});

	pi.on("turn_start", (event) => {
		requestDebugger.onTurnStart(event);
	});

	pi.on("before_provider_request", async (event, nextCtx) => {
		capturePromptTrace(event, nextCtx, {
			activeToolNames: pi.getActiveTools(),
			allTools: pi.getAllTools(),
		});
		await requestDebugger.recordBeforeProviderRequest(event, nextCtx);
	});

	onAfterProviderResponse(pi, (event, nextCtx) => {
		captureProviderResponse(event, nextCtx);
	});

	pi.on("session_shutdown", () => {
		if (ctx) {
			clearPlaygroundWidget(ctx);
		}
		ctx = undefined;
		offLeader?.();
		offLeader = undefined;
		requestDebugger.onSessionShutdown();
	});
}
