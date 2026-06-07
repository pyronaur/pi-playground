import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import {
	KITCHEN_SINK_PRESET_COUNT,
	KitchenSinkGallery,
} from "../src/modules/kitchen-sink.ts";

function createTheme() {
	return {
		fg(_color: string, value: string) {
			return value;
		},
		bg(_color: string, value: string) {
			return value;
		},
		bold(value: string) {
			return value;
		},
	};
}

function createGallery() {
	let closed = false;
	let renders = 0;
	const overlayHandles: Array<{ hidden: boolean; focused: boolean }> = [];
	const widgets = new Map<string, unknown>();
	const tui = {
		terminal: {
			rows: 40,
			columns: 120,
		},
		requestRender() {
			renders += 1;
		},
		showOverlay() {
			const state = { hidden: false, focused: false };
			overlayHandles.push(state);
			return {
				hide() {
					state.hidden = true;
				},
				setHidden(hidden: boolean) {
					state.hidden = hidden;
				},
				isHidden() {
					return state.hidden;
				},
				focus() {
					state.focused = true;
				},
				unfocus() {
					state.focused = false;
				},
				isFocused() {
					return state.focused;
				},
			};
		},
	};
	const ctx = {
		ui: {
			setWidget(key: string, content: unknown) {
				if (content === undefined) {
					widgets.delete(key);
					return;
				}
				widgets.set(key, content);
			},
		},
	};
	const gallery = new KitchenSinkGallery({
		...tui,
	} as never, createTheme() as never, ctx as never, () => {
		closed = true;
	});

	return {
		gallery,
		isClosed: () => closed,
		renderCount: () => renders,
		overlayHandles,
		widgets,
	};
}

function assertLinesFit(lines: string[], width: number): void {
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= width);
	}
}

void test("kitchen sink gallery can enter and close every registered preset", () => {
	for (let index = 0; index < KITCHEN_SINK_PRESET_COUNT; index += 1) {
		const harness = createGallery();
		for (let step = 0; step < index; step += 1) {
			harness.gallery.handleInput("\x1b[B");
		}

		harness.gallery.handleInput("\r");
		assertLinesFit(harness.gallery.render(96), 96);
		harness.gallery.handleInput("\x1b");

		assert.equal(harness.isClosed(), true);
		assert.ok(harness.renderCount() > 0);
	}
});

void test("kitchen sink gallery renders a full framed surface", () => {
	const harness = createGallery();
	const lines = harness.gallery.render(96);

	assert.equal(lines.length, 40);
	assert.match(lines[0] ?? "", /^╭ Kitchen Sink /);
	assert.match(lines.at(-1) ?? "", /^╰/);
	assertLinesFit(lines, 96);
});
