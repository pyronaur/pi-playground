import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function clampEditorPadding(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 0;
	}

	return Math.max(0, Math.min(3, Math.floor(value)));
}

function readEditorPadding(path: string): number | undefined {
	if (!existsSync(path)) {
		return undefined;
	}

	try {
		const text = readFileSync(path, "utf8");
		const parsed = JSON.parse(text);
		if (!isRecord(parsed) || !("editorPaddingX" in parsed)) {
			return undefined;
		}

		return clampEditorPadding(parsed.editorPaddingX);
	} catch {
		return undefined;
	}
}

export function getEditorPaddingX(cwd: string): number {
	const globalPadding = readEditorPadding(join(homedir(), ".pi", "agent", "settings.json")) ?? 0;
	const projectPadding = readEditorPadding(join(cwd, ".pi", "settings.json"));
	return projectPadding ?? globalPadding;
}
