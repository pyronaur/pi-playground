import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

type PromptScope = "project" | "user";

export type PromptFileSource = {
	path: string;
	scope: PromptScope;
};

export type PromptContextFile = {
	path: string;
	content: string;
};

const CONTEXT_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"] as const;

export function readIfExists(path: string | undefined): string | undefined {
	if (!path || !existsSync(path)) {
		return undefined;
	}

	return readFileSync(path, "utf8");
}

export function discoverPromptFile(
	cwd: string,
	agentDir: string,
	name: "SYSTEM.md" | "APPEND_SYSTEM.md",
): PromptFileSource | undefined {
	const projectPath = join(cwd, ".pi", name);
	if (existsSync(projectPath)) {
		return { path: projectPath, scope: "project" };
	}

	const userPath = join(agentDir, name);
	if (existsSync(userPath)) {
		return { path: userPath, scope: "user" };
	}

	return undefined;
}

function loadContextFileFromDir(dir: string): PromptContextFile | undefined {
	for (const name of CONTEXT_FILE_NAMES) {
		const path = join(dir, name);
		if (!existsSync(path)) {
			continue;
		}

		return {
			path,
			content: readFileSync(path, "utf8"),
		};
	}

	return undefined;
}

export function loadProjectContextFiles(cwd: string, agentDir: string): PromptContextFile[] {
	const files: PromptContextFile[] = [];
	const seen = new Set<string>();
	const globalFile = loadContextFileFromDir(agentDir);
	if (globalFile) {
		files.push(globalFile);
		seen.add(resolve(globalFile.path));
	}

	const ancestors: PromptContextFile[] = [];
	let current = resolve(cwd);
	const root = resolve(sep);
	while (true) {
		const file = loadContextFileFromDir(current);
		if (file) {
			const key = resolve(file.path);
			if (!seen.has(key)) {
				ancestors.unshift(file);
				seen.add(key);
			}
		}
		if (current === root) {
			break;
		}

		const parent = resolve(current, "..");
		if (parent === current) {
			break;
		}
		current = parent;
	}

	files.push(...ancestors);
	return files;
}
