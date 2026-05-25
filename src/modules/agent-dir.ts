import { homedir } from "node:os";
import { join } from "node:path";

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

export function getAgentDir(env: NodeJS.ProcessEnv = process.env): string {
	const envDir = env.PI_CODING_AGENT_DIR;
	if (envDir) {
		return expandHome(envDir);
	}

	return join(homedir(), ".pi", "agent");
}
