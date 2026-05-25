import type { ToolInfo } from "@mariozechner/pi-coding-agent";

function tool(name: string, description: string): ToolInfo {
	return {
		name,
		description,
		parameters: { type: "object" },
		sourceInfo: { path: `/tools/${name}.ts` },
	};
}

export function promptToolOptions(allTools: ToolInfo[] = [
	tool("read", "Read files"),
	tool("cmux", "Drive the attached cmux pane"),
]) {
	return {
		activeToolNames: ["read", "cmux"],
		allTools,
	};
}

export function promptNavigatorTools(): ToolInfo[] {
	return [
		tool("read", "Read files"),
		tool("cmux", "Drive the attached cmux pane"),
		tool("bash", "Run bash"),
	];
}
