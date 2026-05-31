export type Preset = {
	id: string;
	label: string;
	description: string;
	source: string;
	use: string;
};

export const PRESETS: Preset[] = [
	{
		id: "modal-select-card",
		label: "Modal Select Card",
		description: "Centered decision card with descriptions and a highlighted row.",
		source: "#pi/tui SelectList + official preset.ts",
		use: "Choose one item from a small or medium set.",
	},
	{
		id: "inline-input-overlay",
		label: "Inline Input Overlay",
		description: "Floating single-answer input card.",
		source: "#pi/tui overlays + Focusable input rule",
		use: "Collect one focused text answer without replacing the whole TUI.",
	},
	{
		id: "search-preview-overlay",
		label: "Search + Preview Overlay",
		description: "Filter, result list, selected details, and primary action.",
		source: "pi-input-ergonomics history search overlay",
		use: "Pick from many text/history/resource items and inspect before applying.",
	},
	{
		id: "searchable-settings-panel",
		label: "Searchable Settings Panel",
		description: "Grouped settings with search, toggles, and inline text edit.",
		source: "#pi/tui SettingsList + pi-extension-settings",
		use: "Configure extension modes and options inside Pi.",
	},
	{
		id: "leader-hint-bar",
		label: "Leader Hint Bar",
		description: "Above-editor pending-key bar with next-key actions.",
		source: "pi-leader + pi-janitor auto-hide widget",
		use: "Expose a fast shortcut palette without opening a modal.",
	},
	{
		id: "draft-editor-modal",
		label: "Draft Editor Modal",
		description: "Multi-line draft editor with mode/status badge.",
		source: "#pi/tui CustomEditor + modal-editor.ts + pi-modal",
		use: "Collect or edit longer text before applying it.",
	},
	{
		id: "multi-step-wizard-card",
		label: "Multi-Step Wizard Card",
		description: "Tabbed steps, option rows, and inline custom-answer mode.",
		source: "official questionnaire.ts + question.ts",
		use: "Guide multi-question setup or structured decisions.",
	},
	{
		id: "tree-action-overlay",
		label: "Tree Action Overlay",
		description: "Expandable tree with bulk selection and detail panel.",
		source: "pi-janitor cleanup overlay",
		use: "Operate on grouped hierarchical resources.",
	},
	{
		id: "progress-action-card",
		label: "Progress Action Card",
		description: "Progress card with running, cancelled, and completed states.",
		source: "#pi/tui BorderedLoader + qna.ts + handoff.ts",
		use: "Show async work with visible progress and cancellation.",
	},
	{
		id: "autocomplete-suggestion-popup",
		label: "Autocomplete Suggestion Popup",
		description: "Editor trigger token with suggestion popup and insertion result.",
		source: "github-issue-autocomplete.ts + ctx.ui.addAutocompleteProvider",
		use: "Discover and insert structured references while composing prompt text.",
	},
	{
		id: "ordered-multi-select-reorder-panel",
		label: "Ordered Multi-Select Reorder Panel",
		description: "Multi-select rows with order badges and reorder controls.",
		source: "pi-extension-settings",
		use: "Choose multiple items and preserve meaningful order.",
	},
	{
		id: "overlay-focus-cycling-workspace",
		label: "Overlay Focus-Cycling Workspace",
		description: "Multiple overlay panels with active focus and local controls.",
		source: "overlay-qa-tests.ts",
		use: "Coordinate side panels without replacing the whole TUI.",
	},
	{
		id: "event-fed-power-bar",
		label: "Event-Fed Power Bar",
		description: "Compact segment bar with simulated event-fed updates.",
		source: "pi-powerbar",
		use: "Expose continuously updated mode/status data with configurable segments.",
	},
];

export const KITCHEN_SINK_PRESET_COUNT = PRESETS.length;

export const SELECT_ROWS = [
	{ label: "Plan review", description: "Open a plan review flow with a compact summary." },
	{ label: "Prompt inspector", description: "Inspect the current prompt source manifest." },
	{ label: "Session handoff", description: "Prepare a handoff note for a future agent." },
	{ label: "Extension settings", description: "Open a configuration surface for this extension." },
];

export const SEARCH_ITEMS = [
	{ label: "latest prompt history entry", detail: "Replace editor text with a previous prompt." },
	{ label: "current system prompt", detail: "Open a prompt-source inspector." },
	{ label: "playground request log", detail: "Reveal the request JSONL artifact." },
	{ label: "janitor cleanup result", detail: "Reopen the latest retained scan result." },
	{ label: "leader menu registration", detail: "Preview registered next-key actions." },
];

export const TREE_ROWS = [
	{ id: "root", label: "tmp/tasks/play-kitchen", depth: 0 },
	{ id: "todo", label: "todo.md", depth: 1 },
	{ id: "notes", label: "notes.md", depth: 1 },
	{ id: "research", label: "research/", depth: 1 },
	{ id: "official", label: "official-pi-examples-interactive-patterns.md", depth: 2 },
	{ id: "local", label: "local-pi-extensions-batch-1.md", depth: 2 },
	{ id: "librarian", label: "librarian-pi-ecosystem-batch-1.md", depth: 2 },
];

export const ORDERED_ROWS = ["prompt", "tools", "docs", "skills", "git", "tests"];

function includesText(value: string, query: string): boolean {
	return value.toLowerCase().includes(query.toLowerCase());
}

function autocompleteQuery(text: string): string {
	const index = text.lastIndexOf("#");
	if (index < 0) return "";
	return text.slice(index + 1);
}

export function autocompleteSuggestions(text: string): string[] {
	const query = autocompleteQuery(text);
	const suggestions = [
		"docs/pi/tui",
		"docs/playground-mode",
		"skill/code-ts",
		"file:README.md",
		"session:current",
	];
	if (!query) return suggestions;
	return suggestions.filter((item) => includesText(item, query));
}
