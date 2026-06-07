import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { KitchenSinkGallery } from "./kitchen-sink.ts";

export class KitchenSink {
	async open(ctx: Pick<ExtensionContext, "hasUI" | "ui">): Promise<void> {
		if (!ctx.hasUI) return;

		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) => new KitchenSinkGallery(tui, theme, ctx, () => done(undefined)),
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: "100%",
					maxHeight: "100%",
					margin: 0,
				},
			},
		);
	}
}
