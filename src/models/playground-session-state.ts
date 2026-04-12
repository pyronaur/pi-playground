import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export const PLAYGROUND_STATE_TYPE = "playground-state";

type PlaygroundSessionStateInput = {
	active: boolean;
	requestLogging: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isPlaygroundStateEntry(
	entry: SessionEntry | undefined,
): entry is Extract<SessionEntry, { type: "custom" }> {
	if (!entry || entry.type !== "custom") {
		return false;
	}

	return "customType" in entry;
}

export class PlaygroundSessionState {
	readonly active: boolean;
	readonly requestLogging: boolean;

	constructor(input: PlaygroundSessionStateInput) {
		this.active = input.active;
		this.requestLogging = input.active ? input.requestLogging : false;
	}

	static inactive(): PlaygroundSessionState {
		return new PlaygroundSessionState({ active: false, requestLogging: false });
	}

	static load(entries: SessionEntry[]): PlaygroundSessionState {
		for (let i = entries.length - 1; i >= 0; i -= 1) {
			const entry = entries[i];
			if (!isPlaygroundStateEntry(entry) || entry.customType !== PLAYGROUND_STATE_TYPE) {
				continue;
			}

			const state = PlaygroundSessionState.fromUnknown(entry.data);
			if (state) {
				return state;
			}
		}

		return PlaygroundSessionState.inactive();
	}

	static fromUnknown(value: unknown): PlaygroundSessionState | undefined {
		if (!isRecord(value)) {
			return undefined;
		}

		const active = value.active;
		const requestLogging = value.requestLogging;
		if (typeof active !== "boolean" || typeof requestLogging !== "boolean") {
			return undefined;
		}

		return new PlaygroundSessionState({ active, requestLogging });
	}

	toData(): PlaygroundSessionStateInput {
		return {
			active: this.active,
			requestLogging: this.requestLogging,
		};
	}

	with(input: Partial<PlaygroundSessionStateInput>): PlaygroundSessionState {
		return new PlaygroundSessionState({
			active: input.active ?? this.active,
			requestLogging: input.requestLogging ?? this.requestLogging,
		});
	}
}
