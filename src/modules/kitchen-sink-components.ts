import { Text } from "@earendil-works/pi-tui";

import { createControlDemo } from "./kitchen-sink-control-demos.ts";
import { type DemoComponent, type DemoHost } from "./kitchen-sink-demo-kit.ts";
import { createEditorDemo } from "./kitchen-sink-editor-demos.ts";
import { createPatternDemo } from "./kitchen-sink-pattern-demos.ts";

function createKitchenSinkDemo(id: string, host: DemoHost): DemoComponent {
	return createControlDemo(id, host)
		?? createEditorDemo(id, host)
		?? createPatternDemo(id, host)
		?? new Text(host.theme.fg("warning", "Unknown kitchen-sink preset."));
}

export type { DemoComponent, DemoHost };
export { createKitchenSinkDemo };
