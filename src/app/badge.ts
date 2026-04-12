import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

const LABEL = "Playground";
const SOFT_GREEN = "\u001b[38;2;166;219;180m";
const RESET = "\u001b[0m";

let closeBadge: (() => void) | undefined;
let badgeHandle: { focus?: () => void } | undefined;

type BadgeCtx = Pick<ExtensionContext, "hasUI" | "ui">;

function makeBadge(theme: { fg(name: string, text: string): string }) {
	return {
		render(width: number) {
			const top = " ".repeat(width);
			const text = `  ${SOFT_GREEN}${LABEL}${RESET}`;
			const pad = " ".repeat(Math.max(0, width - 2 - LABEL.length));
			const line = theme.fg("dim", "─".repeat(width));
			return [top, text + pad, line];
		},
		invalidate() {},
	};
}

export function clearPlaygroundBadge() {
	if (!closeBadge) return;

	const close = closeBadge;
	closeBadge = undefined;
	badgeHandle?.focus?.();
	badgeHandle = undefined;
	close();
}

export function showPlaygroundBadge(ctx: BadgeCtx) {
	if (!ctx.hasUI || closeBadge) return;

	void ctx.ui.custom(
		(_tui, theme, _keybindings, done) => {
			closeBadge = () => done(undefined);
			return makeBadge(theme);
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "top-left",
				width: "100%",
				margin: 0,
				offsetX: 0,
				offsetY: 0,
				nonCapturing: true,
			},
			onHandle: (handle) => {
				badgeHandle = handle;
			},
		},
	).catch(() => {});
}
