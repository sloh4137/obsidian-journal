import { BasesEntry, BasesView, Component, QueryController } from "obsidian";
import type JournalPlugin from "../main";
import {
	getPhotosForEntry,
	openEntry,
	parseEntryDate,
	renderEntryTextBlock,
} from "./shared";

export const ENTRIES_VIEW_TYPE = "journal-entries";

const PAGE_SIZE = 7;

export class EntriesBasesView extends BasesView {
	type = ENTRIES_VIEW_TYPE;

	private listEl: HTMLElement | null = null;
	private sentinelEl: HTMLElement | null = null;
	private observer: IntersectionObserver | null = null;
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
		this.markdownComponent?.unload();
		this.markdownComponent = null;
		super.onunload();
	}

	onDataUpdated(): void {
		this.markdownComponent?.unload();
		this.markdownComponent = new Component();
		this.markdownComponent.load();
		const dateProp = this.plugin.settings.journalDateProperty;
		const entries = this.data.data.slice();
		entries.sort((a, b) => {
			const ad = parseEntryDate(this.app, a, dateProp);
			const bd = parseEntryDate(this.app, b, dateProp);
			if (!ad && !bd) return 0;
			if (!ad) return 1;
			if (!bd) return -1;
			return bd.valueOf() - ad.valueOf();
		});
		this.sorted = entries;
		this.rendered = 0;

		this.containerEl.empty();
		this.containerEl.addClass("journal-entries-view");
		this.listEl = this.containerEl.createDiv({ cls: "journal-entries-list" });
		this.sentinelEl = this.containerEl.createDiv({
			cls: "journal-entries-sentinel",
		});

		this.observer?.disconnect();
		this.observer = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (e.isIntersecting) this.renderNextPage();
			}
		});
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

		const body = card.createDiv({ cls: "journal-entry-card-body" });
		// Default to no-image, will be removed if a photo is found
		body.addClass("no-image");

		const textEl = body.createDiv({ cls: "journal-entry-card-text" });
		if (this.markdownComponent) {
			void renderEntryTextBlock(
				this.app,
				textEl,
				entry.file,
				this.markdownComponent
			);
		}

		void getPhotosForEntry(this.app, entry).then((photos) => {
			const first = photos[0];
			if (!first) return;
			body.removeClass("no-image");
			const thumb = body.createDiv({ cls: "journal-entry-card-thumb" });
			thumb.style.backgroundImage = `url("${first.thumbnailUrl}")`;
		});
	}
}
