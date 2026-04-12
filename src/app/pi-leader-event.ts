type PiLeaderAddOptions = {
	side?: "left" | "right";
	group?: string;
	groupOrder?: number;
	order?: number;
	keyLabel?: string;
};

type PiLeaderActionContext = {
	openSubmenu: (kind: string, items: PiLeaderItem[]) => void;
};

type PiLeaderItem = {
	key: string;
	label: string | ((...args: unknown[]) => string);
	run: (ctx: PiLeaderActionContext) => void | Promise<void>;
	options?: PiLeaderAddOptions;
};

type PiLeaderAdd = (
	key: string,
	label: string | ((...args: unknown[]) => string),
	run: (ctx: PiLeaderActionContext) => void | Promise<void>,
	options?: PiLeaderAddOptions,
) => void;

type PiLeaderOpenEvent = {
	add: PiLeaderAdd;
};

export function isPiLeaderOpenEvent(event: unknown): event is PiLeaderOpenEvent {
	if (typeof event !== "object" || event === null) {
		return false;
	}

	if (!("add" in event)) {
		return false;
	}

	return typeof event.add === "function";
}
