export type EditorCommand = {
	command: string;
	args: string[];
};

export function getEditorCommandFromEnv(env: NodeJS.ProcessEnv): EditorCommand | undefined {
	const editorCmd = env.VISUAL || env.EDITOR;
	if (!editorCmd) {
		return undefined;
	}

	const [command, ...args] = editorCmd.split(" ").filter(Boolean);
	if (!command) {
		return undefined;
	}

	return { command, args };
}
