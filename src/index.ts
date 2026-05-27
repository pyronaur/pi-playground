import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerPlayground } from "./app/register-playground.ts";

export default function register(pi: ExtensionAPI) {
	registerPlayground(pi);
}
