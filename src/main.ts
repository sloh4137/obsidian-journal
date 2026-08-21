import {
	App,
	CachedMetadata,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	TFile,
	moment,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	JournalPluginSettings,
	JournalSettingTab,
} from "./settings";
import { updateCoordinates } from "./frontmatter";
import { IMMICH_PLUGIN_ID, getImmichApi } from "./immich";
import { ENTRIES_VIEW_TYPE, EntriesBasesView } from "./views/entries";
import { CALENDAR_VIEW_TYPE, CalendarBasesView } from "./views/calendar";
import { MEMORIES_VIEW_TYPE, MemoriesBasesView } from "./views/memories";

export default class JournalPlugin extends Plugin {
	settings: JournalPluginSettings;
	private lastFirstImmichHash = new Map<string, string | undefined>();

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "set-coordinates-from-device-gps",
			name: "Set coordinates from device location",
			checkCallback: (checking: boolean) => {
				const file =
					this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				if (!file) return false;
				if (!checking) {
					if (!navigator.geolocation) {
						new Notice(
							"Geolocation is not supported on this device"
						);
						return;
					}
					navigator.geolocation.getCurrentPosition(
						(pos) => {
							void (async () => {
								await updateCoordinates(
									this.app,
									file,
									pos.coords.latitude,
									pos.coords.longitude
								);
								new Notice(
									"Coordinates updated from device location"
								);
							})();
						},
						(err) => {
							new Notice(
								`Could not get device location: ${err.message}`
							);
						}
					);
				}
				return true;
			},
		});

		this.addCommand({
			id: "set-coordinates-from-immich-images",
			name: "Set coordinates from immich images",
			checkCallback: (checking: boolean) => {
				const file =
					this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
				if (!file) return false;
				if (!checking) {
					void this.setCoordinatesFromImmich(file);
				}
				return true;
			},
		});

		this.registerEvent(
			this.app.metadataCache.on("changed", (file, _data, cache) => {
				this.handleImmichImagesChange(file, cache);
				void this.handleJournalTimeChange(file, cache);
			})
		);

		this.registerJournalBasesViews();

		this.addSettingTab(new JournalSettingTab(this.app, this));
	}

	private registerJournalBasesViews() {
		const ok =
			this.registerBasesView(MEMORIES_VIEW_TYPE, {
				name: "Journal Memories",
				icon: "history",
				factory: (controller, containerEl) =>
					new MemoriesBasesView(controller, containerEl, this),
			}) &&
			this.registerBasesView(ENTRIES_VIEW_TYPE, {
				name: "Journal Entries",
				icon: "list",
				factory: (controller, containerEl) =>
					new EntriesBasesView(controller, containerEl, this),
			}) &&
			this.registerBasesView(CALENDAR_VIEW_TYPE, {
				name: "Journal Calendar",
				icon: "calendar",
				factory: (controller, containerEl) =>
					new CalendarBasesView(controller, containerEl, this),
			});
		if (!ok) {
			console.warn(
				"Bases is not enabled in this vault; journal views are unavailable"
			);
		}
	}

	private firstImmichHash(
		cache: CachedMetadata | undefined
	): string | undefined {
		const images: unknown =
			cache?.frontmatter?.[this.settings.immichImagesProperty];
		if (!Array.isArray(images)) return undefined;
		const first: unknown = (images as unknown[])[0];
		return typeof first === "string" ? first : undefined;
	}

	private isInJournalFolder(file: TFile): boolean {
		const folder = this.settings.journalEntriesFolder.replace(
			/^\/+|\/+$/g,
			""
		);
		if (folder === "") return true;
		return file.path === folder || file.path.startsWith(`${folder}/`);
	}

	private handleImmichImagesChange(file: TFile, cache: CachedMetadata) {
		if (!this.isInJournalFolder(file)) return;
		const firstHash = this.firstImmichHash(cache);
		const seen = this.lastFirstImmichHash.has(file.path);
		const previous = this.lastFirstImmichHash.get(file.path);
		this.lastFirstImmichHash.set(file.path, firstHash);

		if (!seen) return;
		if (previous === firstHash) return;
		if (firstHash === undefined) return;

		new ConfirmImmichCoordinatesModal(this.app, firstHash, () => {
			void this.setCoordinatesFromImmich(file);
		}).open();
	}

	private extractDate(value: unknown): string | undefined {
		if (value instanceof Date) {
			const m = moment(value);
			return m.isValid() ? m.format("YYYY-MM-DD") : undefined;
		}
		if (typeof value === "string") {
			const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
			return match ? match[1] : undefined;
		}
		return undefined;
	}

	private async handleJournalTimeChange(file: TFile, cache: CachedMetadata) {
		if (!this.isInJournalFolder(file)) return;
		const date = this.extractDate(cache?.frontmatter?.journalTime);
		if (!date) return;

		const dateProperty = this.settings.journalDateProperty;
		const currentDate = this.extractDate(
			cache?.frontmatter?.[dateProperty]
		);
		if (currentDate !== date) {
			await this.app.fileManager.processFrontMatter(
				file,
				(fm: Record<string, unknown>) => {
					fm[dateProperty] = date;
				}
			);
		}

		const titleMatch = /^\d{4}-\d{2}-\d{2}(.*)$/.exec(file.basename);
		if (!titleMatch) return;
		const newBasename = `${date}${titleMatch[1]}`;
		if (newBasename === file.basename) return;
		const parentPath =
			file.parent && file.parent.path !== "/"
				? `${file.parent.path}/`
				: "";
		const newPath = `${parentPath}${newBasename}.${file.extension}`;
		await this.app.fileManager.renameFile(file, newPath);
	}

	async setCoordinatesFromImmich(file: TFile) {
		const property = this.settings.immichImagesProperty;
		const images: unknown =
			this.app.metadataCache.getFileCache(file)?.frontmatter?.[property];
		if (!Array.isArray(images) || images.length === 0) {
			new Notice(`No "${property}" frontmatter found`);
			return;
		}
		const immich = getImmichApi(this.app);
		if (!immich?.getLatLng) {
			new Notice(
				`Plugin "${IMMICH_PLUGIN_ID}" not found or its API is unavailable`
			);
			return;
		}
		for (const hash of images) {
			if (typeof hash !== "string") continue;
			const latLng = await immich.getLatLng(hash);
			if (latLng) {
				await updateCoordinates(
					this.app,
					file,
					latLng.latitude,
					latLng.longitude
				);
				new Notice("Coordinates updated from immich");
				return;
			}
		}
		new Notice("No coordinates found in immich for any of the images");
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<JournalPluginSettings>
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ConfirmImmichCoordinatesModal extends Modal {
	constructor(app: App, private hash: string, private onConfirm: () => void) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Update coordinates from immich?" });
		const preview =
			this.hash.length > 12 ? `${this.hash.slice(0, 12)}…` : this.hash;
		contentEl.createEl("p", {
			text: `Image ${preview} was just added. Update this note's coordinates from it?`,
		});
		const buttons = contentEl.createDiv({ cls: "modal-button-container" });
		const cancel = buttons.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		const confirm = buttons.createEl("button", {
			text: "Update",
			cls: "mod-cta",
		});
		confirm.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
