import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerPlayground } from "./app/register-playground.ts";

const intentionalGateFailure = true;

export default function register(pi: ExtensionAPI) {
	registerPlayground(pi);
}
