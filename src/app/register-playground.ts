import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	PLAYGROUND_STATE_TYPE,
	PlaygroundSessionState,
} from "../models/playground-session-state.ts";
import { KitchenSink } from "../modules/kitchen-sink-open.ts";
import { PromptNavigator } from "../modules/prompt-navigator.ts";
import { capturePromptTrace, captureProviderResponse } from "../modules/prompt-trace.ts";
import { RequestDebugger } from "../modules/request-debugger.ts";

import { isPiLeaderOpenEvent } from "./pi-leader-event.ts";
import { clearPlaygroundWidget, syncPlaygroundWidget } from "./widget.ts";

type AfterProviderResponseEvent = {
	status: number;
	headers: Record<string, string>;
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

export function registerPlayground(pi: ExtensionAPI) {
	const promptNavigator = new PromptNavigator(pi);
	const kitchenSink = new KitchenSink();
	const requestDebugger = new RequestDebugger();
	let ctx: ExtensionContext | undefined;
	let state = PlaygroundSessionState.inactive();
	let offLeader: (() => void) | undefined;

	function syncUi(): void {
		if (!ctx?.hasUI) {
			return;
		}

		syncPlaygroundWidget(ctx, state);
	}

	function setState(next: PlaygroundSessionState): void {
		const changed = next.active !== state.active || next.requestLogging !== state.requestLogging;
		const requestLoggingChanged = next.requestLogging !== state.requestLogging;
		state = next;
		if (!changed) {
			return;
		}

		pi.appendEntry(PLAYGROUND_STATE_TYPE, state.toData());
		syncUi();
		if (requestLoggingChanged && ctx) {
			requestDebugger.setEnabled(state.requestLogging, ctx);
		}
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

	async function openPlaygroundUi(
		nextCtx: ExtensionContext | undefined,
		open: (ctx: ExtensionContext) => Promise<void>,
	): Promise<boolean> {
		if (!state.active) {
			nextCtx?.ui.notify("Activate playground first with /playground", "warning");
			return false;
		}

		if (!nextCtx?.hasUI) {
			return false;
		}

		await open(nextCtx);
		return true;
	}

	async function openPromptNavigator(nextCtx: ExtensionContext | undefined): Promise<boolean> {
		return openPlaygroundUi(nextCtx, (activeCtx) => promptNavigator.open(activeCtx));
	}

	async function openKitchenSink(nextCtx: ExtensionContext | undefined): Promise<boolean> {
		return openPlaygroundUi(nextCtx, (activeCtx) => kitchenSink.open(activeCtx));
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

	pi.registerCommand("kitchen-sink", {
		description: "Open the playground component-backed UI preset library",
		handler: async (_args, nextCtx) => {
			ctx = nextCtx;
			await openKitchenSink(nextCtx);
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
					{
						key: "k",
						label: "kitchen sink",
						run: async () => {
							await openKitchenSink(ctx);
						},
					},
				]);
			});
		});
	}

	pi.on("session_start", (event, nextCtx) => {
		ctx = nextCtx;
		state = PlaygroundSessionState.load(nextCtx.sessionManager.getEntries());
		attachLeader();
		syncUi();
		requestDebugger.onSessionStart(state.requestLogging, event, nextCtx);
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
