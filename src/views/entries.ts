import { BasesEntry, BasesView, Component, QueryController } from "obsidian";
import type JournalPlugin from "../main";
import {
	createLazyObserver,
	entryTitle,
	getPhotosForEntry,
	openEntry,
	parseEntryDate,
	renderEntryTextBlock,
	setThumbnail,
} from "./shared";

export const ENTRIES_VIEW_TYPE = "journal-entries";

const PAGE_SIZE = 7;

export class EntriesBasesView extends BasesView {
	type = ENTRIES_VIEW_TYPE;

	private listEl: HTMLElement | null = null;
	private sentinelEl: HTMLElement | null = null;
	private observer: IntersectionObserver | null = null;
	private lazy: ReturnType<typeof createLazyObserver> | null = null;
	private sorted: BasesEntry[] = [];
	private rendered = 0;
	private markdownComponent: Component | null = null;

	constructor(
		controller: QueryController,
		private containerEl: HTMLElement,
		private plugin: JournalPlugin
	) {
		super(controller);
	}

	onunload() {
		this.observer?.disconnect();
		this.observer = null;
		this.lazy?.disconnect();
		this.lazy = null;
		this.markdownComponent?.unload();
		this.markdownComponent = null;
		super.onunload();
	}

	onDataUpdated(): void {
		this.markdownComponent?.unload();
		this.markdownComponent = new Component();
		this.markdownComponent.load();
		const dateProp = this.plugin.settings.journalDateProperty;
		const decorated = this.data.data.map((entry) => ({
			entry,
			ts: parseEntryDate(this.app, entry, dateProp)?.valueOf() ?? null,
		}));
		decorated.sort((a, b) => {
			if (a.ts === null && b.ts === null) return 0;
			if (a.ts === null) return 1;
			if (b.ts === null) return -1;
			return b.ts - a.ts;
		});
		this.sorted = decorated.map((d) => d.entry);
		this.rendered = 0;

		this.containerEl.empty();
		this.containerEl.addClass("journal-entries-view");
		this.listEl = this.containerEl.createDiv({ cls: "journal-entries-list" });
		this.sentinelEl = this.containerEl.createDiv({
			cls: "journal-entries-sentinel",
		});

		this.lazy?.disconnect();
		this.lazy = createLazyObserver();

		this.observer?.disconnect();
		this.observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) this.renderNextPage();
				}
			},
			{ rootMargin: "600px" }
		);
		this.observer.observe(this.sentinelEl);

		this.renderNextPage();
	}

	private renderNextPage() {
		if (!this.listEl || !this.sentinelEl) return;
		const end = Math.min(this.rendered + PAGE_SIZE, this.sorted.length);
		for (let i = this.rendered; i < end; i++) {
			const entry = this.sorted[i];
			if (entry) this.renderCard(entry, this.listEl);
		}
		this.rendered = end;
		if (this.rendered >= this.sorted.length) {
			this.observer?.disconnect();
			this.observer = null;
			this.sentinelEl.remove();
			this.sentinelEl = null;
		}
	}

	private renderCard(entry: BasesEntry, parent: HTMLElement) {
		const { journalDateProperty } = this.plugin.settings;
		const date = parseEntryDate(this.app, entry, journalDateProperty);

		const card = parent.createDiv({ cls: "journal-entry-card" });
		card.addEventListener("click", () => {
			void openEntry(this.app, entry.file);
		});

		if (date) {
			const header = card.createDiv({ cls: "journal-entry-card-header" });
			header.setText(date.format("MMM D, YYYY [|] dddd"));
		}

		const title = entryTitle(
			entry.file,
			this.plugin.settings.journalPrefixProperty
		);
		if (title) {
			card.createDiv({ cls: "journal-entry-card-title", text: title });
		}

		const body = card.createDiv({ cls: "journal-entry-card-body" });
		// Default to no-image, will be removed if a photo is found
		body.addClass("no-image");

		const textEl = body.createDiv({ cls: "journal-entry-card-text" });

		this.lazy?.observe(card, () => {
			const component = this.markdownComponent;
			if (component) {
				void renderEntryTextBlock(
					this.app,
					textEl,
					entry.file,
					component
				);
			}
			void getPhotosForEntry(this.app, entry).then((photos) => {
					const first = photos[0];
					if (!first) return;
					const thumb = body.createDiv({
						cls: "journal-entry-card-thumb",
					});
					const url =
						first.previewUrl ||
						first.fullsizeUrl ||
						first.thumbnailUrl;
					setThumbnail(thumb, url, () =>
						body.removeClass("no-image")
					);
				});
		});
	}
}
