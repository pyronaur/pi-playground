import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const INTERESTING_INPUTS = new Map([
	["\r", "enter"],
	["\n", "enter"],
	["\x1b\r", "alt+enter"],
	["\x1b\n", "alt+enter"],
	["\x1b", "escape"],
	["\x03", "ctrl+c"],
]);

const LIFECYCLE_EVENTS = [
	"session_start",
	"before_agent_start",
	"agent_start",
	"turn_start",
	"message_start",
	"message_end",
	"tool_execution_start",
	"tool_execution_end",
	"turn_end",
	"agent_end",
	"session_shutdown",
];

let seq = 0;
let currentCtx;
let inputOff;
let logPath;

function isActive(options) {
	return typeof options.isActive === "function" ? options.isActive() : true;
}

function sessionLogPath(ctx) {
	const sessionFile = ctx?.sessionManager?.getSessionFile?.();
	if (sessionFile) {
		return `${sessionFile}.prompt-flow.jsonl`;
	}
	return join(ctx?.cwd ?? process.cwd(), ".pi", "playground", "prompt-flow.jsonl");
}

function setLogPath(ctx) {
	logPath = sessionLogPath(ctx);
	mkdirSync(dirname(logPath), { recursive: true });
}

function entry(event, data = {}) {
	return {
		seq: ++seq,
		time: new Date().toISOString(),
		event,
		...data,
	};
}

function write(event, data) {
	if (!logPath) {
		setLogPath(currentCtx);
	}
	appendFileSync(logPath, `${JSON.stringify(entry(event, data))}\n`, "utf8");
}

function compactText(value) {
	if (typeof value !== "string") {
		return undefined;
	}
	return value.replaceAll(/\s+/g, " ").trim().slice(0, 120);
}

function summarizeMessage(message) {
	if (!message || typeof message !== "object") {
		return { type: typeof message };
	}
	return {
		role: message.role,
		type: message.type,
		customType: message.customType,
		text: compactText(message.content),
	};
}

function summarizeEvent(event) {
	if (!event || typeof event !== "object") {
		return { valueType: typeof event };
	}
	const summary = { keys: Object.keys(event).sort() };
	if (Array.isArray(event.messages)) {
		summary.messages = event.messages.map(summarizeMessage);
	}
	if (event.message) {
		summary.message = summarizeMessage(event.message);
	}
	if (event.toolCall) {
		summary.toolCall = {
			id: event.toolCall.id,
			name: event.toolCall.name,
		};
	}
	if (event.toolResult) {
		summary.toolResult = {
			id: event.toolResult.id,
			name: event.toolResult.name,
		};
	}
	if (typeof event.systemPrompt === "string") {
		summary.systemPromptLength = event.systemPrompt.length;
	}
	return summary;
}

function inputName(data) {
	return INTERESTING_INPUTS.get(data) ?? null;
}

function inputBytes(data) {
	return Array.from(Buffer.from(data)).map((byte) => byte.toString(16).padStart(2, "0"));
}

function installInputLogger(ctx, options) {
	if (inputOff || !ctx?.ui?.onTerminalInput) {
		return;
	}
	inputOff = ctx.ui.onTerminalInput((data) => {
		if (!isActive(options)) {
			return undefined;
		}
		const key = inputName(data);
		if (!key) {
			return undefined;
		}
		write("terminal_input", {
			key,
			bytes: inputBytes(data),
			editorText: compactText(ctx.ui.getEditorText?.()),
		});
		return undefined;
	});
}

function recordLifecycle(name, event, ctx, options) {
	currentCtx = ctx ?? currentCtx;
	if (ctx) {
		setLogPath(ctx);
		installInputLogger(ctx, options);
	}
	if (!isActive(options)) {
		return;
	}
	write(name, summarizeEvent(event));
}

function resetLog(ctx) {
	currentCtx = ctx ?? currentCtx;
	setLogPath(currentCtx);
	rmSync(logPath, { force: true });
	seq = 0;
	write("log_reset");
}

export default function registerPromptFlowScratch(pi, options = {}) {
	for (const name of LIFECYCLE_EVENTS) {
		pi.on(name, (event, ctx) => recordLifecycle(name, event, ctx, options));
	}

	pi.on("before_provider_request", (event, ctx) => {
		recordLifecycle("before_provider_request", event, ctx, options);
	});

	pi.registerCommand("flow-log-path", {
		description: "Show prompt-flow scratch log path",
		handler: async (_args, ctx) => {
			currentCtx = ctx;
			setLogPath(ctx);
			ctx.ui.notify(logPath, "info");
		},
	});

	pi.registerCommand("flow-log-reset", {
		description: "Reset prompt-flow scratch log",
		handler: async (_args, ctx) => {
			resetLog(ctx);
			ctx.ui.notify(`prompt-flow log reset -> ${logPath}`, "info");
		},
	});

	pi.registerCommand("flow-log-mark", {
		description: "Add a marker to the prompt-flow scratch log",
		handler: async (args, ctx) => {
			currentCtx = ctx;
			setLogPath(ctx);
			write("mark", { text: compactText(args.join(" ")) });
		},
	});

	process.once("exit", () => {
		inputOff?.();
		inputOff = undefined;
	});

	if (!logPath) {
		const fallback = join(process.cwd(), ".pi", "playground", "prompt-flow.jsonl");
		mkdirSync(dirname(fallback), { recursive: true });
		writeFileSync(fallback, "", { flag: "a" });
		logPath = fallback;
	}
}
