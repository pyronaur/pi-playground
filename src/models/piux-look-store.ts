import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LOOK_FILE_PATTERN = /^look-(\d+)\.txt$/;

export class PiuxLookStore {
	readonly root: string;
	#nextId: number | undefined;
	#previousScreen: string | undefined;

	constructor(root = "/tmp/piux/.playground") {
		this.root = root;
	}

	getPreviousScreen(): string | undefined {
		return this.#previousScreen;
	}

	async saveScreen(screen: string): Promise<string> {
		await mkdir(this.root, { recursive: true });
		const id = await this.getNextId();
		const path = join(this.root, `look-${id}.txt`);
		await writeFile(path, screen, "utf8");
		this.#previousScreen = screen;
		return path;
	}

	private async getNextId(): Promise<number> {
		if (this.#nextId !== undefined) {
			const nextId = this.#nextId;
			this.#nextId += 1;
			return nextId;
		}

		let maxId = 0;
		try {
			for (const name of await readdir(this.root)) {
				const match = LOOK_FILE_PATTERN.exec(name);
				const idText = match?.[1];
				if (!idText) {
					continue;
				}

				const id = Number.parseInt(idText, 10);
				if (Number.isNaN(id)) {
					continue;
				}

				maxId = Math.max(maxId, id);
			}
		} catch {
			maxId = 0;
		}

		this.#nextId = maxId + 2;
		return maxId + 1;
	}
}
