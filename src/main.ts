import {
	CachedMetadata,
	MarkdownView,
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
import {
	IMMICH_MEMORIES_PLUGIN_ID,
	getImmichMemoriesApi,
	getImmichDateAndTimezoneFields,
	getLatLngForPhotos,
	getPhotosForFile,
} from "./immich";
import { ENTRIES_VIEW_TYPE, EntriesBasesView } from "./views/entries";
import { CALENDAR_VIEW_TYPE, CalendarBasesView } from "./views/calendar";
import { MEMORIES_VIEW_TYPE, MemoriesBasesView } from "./views/memories";

export default class JournalPlugin extends Plugin {
	settings: JournalPluginSettings;

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
			name: "Set coordinates from immich memories",
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

	private isInJournalFolder(file: TFile): boolean {
		const folder = this.settings.journalEntriesFolder.replace(
			/^\/+|\/+$/g,
			""
		);
		if (folder === "") return true;
		return file.path === folder || file.path.startsWith(`${folder}/`);
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
		const { dateField, timezoneField } =
			getImmichDateAndTimezoneFields(this.app);

		const api = getImmichMemoriesApi(this.app);
		if (!api) {
			new Notice(
				`Plugin "${IMMICH_MEMORIES_PLUGIN_ID}" not found or its API is unavailable`
			);
			return;
		}

		const photos = await getPhotosForFile(this.app, file);
		if (photos.length === 0) {
			new Notice(
				`No photos found for this entry's ${dateField} / ${timezoneField}. Make sure ${dateField} and ${timezoneField} frontmatter are set and Immich Memories is configured.`
			);
			return;
		}

		const latLng = await getLatLngForPhotos(this.app, photos);
		if (latLng) {
			await updateCoordinates(
				this.app,
				file,
				latLng.latitude,
				latLng.longitude
			);
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			new Notice("Coordinates updated from Immich memories");
			return;
		}
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		new Notice("No coordinates found in Immich for any of the photos");
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
