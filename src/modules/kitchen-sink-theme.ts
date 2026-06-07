import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, SelectListTheme, SettingsListTheme } from "@earendil-works/pi-tui";

type Theme = ExtensionContext["ui"]["theme"];

function selectListTheme(theme: Theme): SelectListTheme {
	return {
		selectedPrefix: (value) => theme.fg("accent", value),
		selectedText: (value) => theme.fg("accent", value),
		description: (value) => theme.fg("muted", value),
		scrollInfo: (value) => theme.fg("dim", value),
		noMatch: () => theme.fg("warning", "  No matching items"),
	};
}

function settingsListTheme(theme: Theme): SettingsListTheme {
	return {
		label: (value, selected) => selected ? theme.fg("accent", value) : value,
		value: (value, selected) => selected ? theme.fg("accent", value) : theme.fg("muted", value),
		description: (value) => theme.fg("muted", value),
		cursor: theme.fg("accent", ">"),
		hint: (value) => theme.fg("dim", value),
	};
}

function editorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (value) => theme.fg("accent", value),
		selectList: selectListTheme(theme),
	};
}

export type { Theme };
export { editorTheme, selectListTheme, settingsListTheme };
