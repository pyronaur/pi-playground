import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import {
	PLAYGROUND_STATE_TYPE,
	PlaygroundSessionState,
} from "../models/playground-session-state.ts";
import { RequestDebugger } from "../modules/request-debugger.ts";

import { isPiLeaderOpenEvent } from "./pi-leader-event.ts";
import { clearPlaygroundWidget, syncPlaygroundWidget } from "./widget.ts";

function getRequestLoggingLabel(state: PlaygroundSessionState): string {
	return state.requestLogging ? "toggle request logging (on)" : "toggle request logging";
}

export function registerPlayground(pi: ExtensionAPI) {
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

	function attachLeader(): void {
		offLeader?.();
		offLeader = pi.events.on("pi-leader", (event) => {
			if (!isPiLeaderOpenEvent(event)) {
				return;
			}

			event.add("g", "playground", ({ openSubmenu }) => {
				if (!state.active) {
					setState(state.with({ active: true }));
					return;
				}

				openSubmenu("playground", [
					{
						key: "r",
						label: getRequestLoggingLabel(state),
						run: () => {
							setState(state.with({ requestLogging: !state.requestLogging }));
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
		await requestDebugger.recordBeforeProviderRequest(event, nextCtx);
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
