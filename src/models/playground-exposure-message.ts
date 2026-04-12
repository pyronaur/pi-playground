import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export const PLAYGROUND_EXPOSURE_TYPE = "playground-exposure";
const PLAYGROUND_RUNBOOK = "@docs/piux.md";
const PLAYGROUND_ROOT_COMPACTION_ID = "root";

type PlaygroundExposureInput = {
	compactionId: string;
	sessionId: string;
	sessionFile: string;
	runbook: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export class PlaygroundExposureMessage {
	readonly compactionId: string;
	readonly sessionId: string;
	readonly sessionFile: string;
	readonly runbook: string;

	constructor(input: PlaygroundExposureInput) {
		this.compactionId = input.compactionId;
		this.sessionId = input.sessionId;
		this.sessionFile = input.sessionFile;
		this.runbook = input.runbook;
	}

	static create(input: {
		compactionId: string;
		sessionId: string;
		sessionFile: string | undefined;
	}): PlaygroundExposureMessage {
		return new PlaygroundExposureMessage({
			compactionId: input.compactionId,
			sessionId: input.sessionId,
			sessionFile: input.sessionFile ?? "ephemeral (no session jsonl file)",
			runbook: PLAYGROUND_RUNBOOK,
		});
	}

	static fromEntry(entry: SessionEntry | undefined): PlaygroundExposureMessage | undefined {
		if (!entry || entry.type !== "custom_message") {
			return undefined;
		}

		if (entry.customType !== PLAYGROUND_EXPOSURE_TYPE) {
			return undefined;
		}

		return PlaygroundExposureMessage.fromUnknown(entry.details);
	}

	static fromUnknown(value: unknown): PlaygroundExposureMessage | undefined {
		if (!isRecord(value)) {
			return undefined;
		}

		const compactionId = value.compactionId;
		const sessionId = value.sessionId;
		const sessionFile = value.sessionFile;
		const runbook = value.runbook;
		if (
			typeof compactionId !== "string"
			|| typeof sessionId !== "string"
			|| typeof sessionFile !== "string"
			|| typeof runbook !== "string"
		) {
			return undefined;
		}

		return new PlaygroundExposureMessage({
			compactionId,
			sessionId,
			sessionFile,
			runbook,
		});
	}

	static getCompactionId(entries: SessionEntry[]): string {
		for (let i = entries.length - 1; i >= 0; i -= 1) {
			const entry = entries[i];
			if (entry?.type === "compaction") {
				return entry.id;
			}
		}

		return PLAYGROUND_ROOT_COMPACTION_ID;
	}

	get title(): string {
		return "Playground session context";
	}

	get body(): string {
		return [
			this.title,
			`Session ID: ${this.sessionId}`,
			`Session file: ${this.sessionFile}`,
			`Runbook: ${this.runbook}`,
		].join("\n");
	}

	matchesCompaction(compactionId: string): boolean {
		return this.compactionId === compactionId;
	}

	matchesContext(message: PlaygroundExposureMessage): boolean {
		return this.compactionId === message.compactionId
			&& this.sessionId === message.sessionId
			&& this.sessionFile === message.sessionFile;
	}

	toDetails(): PlaygroundExposureInput {
		return {
			compactionId: this.compactionId,
			sessionId: this.sessionId,
			sessionFile: this.sessionFile,
			runbook: this.runbook,
		};
	}

	toMessage(): {
		customType: typeof PLAYGROUND_EXPOSURE_TYPE;
		content: string;
		display: true;
		details: ReturnType<PlaygroundExposureMessage["toDetails"]>;
	} {
		return {
			customType: PLAYGROUND_EXPOSURE_TYPE,
			content: this.body,
			display: true,
			details: this.toDetails(),
		};
	}
}
