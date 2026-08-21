import {
	App,
	BasesEntry,
	BasesView,
	Component,
	Modal,
	QueryController,
	moment as obsidianMoment,
} from "obsidian";
// eslint-disable-next-line no-restricted-imports
import type { Moment } from "moment";

const moment = obsidianMoment as unknown as typeof import("moment");
import type JournalPlugin from "../main";
import type { ImmichPhoto } from "../immich";
import { getPhotosForDateString } from "../immich";
import {
	openEntry,
	parseEntryDate,
	readTimezoneForEntry,
	renderEntryTextBlock,
} from "./shared";

export const MEMORIES_VIEW_TYPE = "journal-memories";

interface Period {
	label: string;
	entry: BasesEntry;
	photos: ImmichPhoto[];
	dateStr: string;
	timeZone: string;
}

export class MemoriesBasesView extends BasesView {
	type = MEMORIES_VIEW_TYPE;

	private periods: Period[] = [];

	constructor(
		controller: QueryController,
		private containerEl: HTMLElement,
		private plugin: JournalPlugin
	) {
		super(controller);
	}

	onDataUpdated(): void {
		void (async () => {
			const { journalDateProperty } = this.plugin.settings;

			const byDay = new Map<string, BasesEntry>();
			let oldest: Moment | null = null;
			for (const entry of this.data.data) {
				const m = parseEntryDate(this.app, entry, journalDateProperty);
				if (!m) continue;
				byDay.set(m.format("YYYY-MM-DD"), entry);
				if (!oldest || m.isBefore(oldest)) oldest = m.clone();
			}

			this.periods = [];
			if (oldest) {
				const today = moment().startOf("day");
				const candidates: { label: string; date: Moment }[] = [
					{
						label: "30 days ago",
						date: today.clone().subtract(30, "days"),
					},
				];
				let years = 1;
				while (true) {
					const d = today.clone().subtract(years, "years");
					if (d.isBefore(oldest, "day")) break;
					candidates.push({
						label: `${years} ${years === 1 ? "year" : "years"} ago`,
						date: d,
					});
					years++;
				}

				const results: Period[] = [];
				await Promise.all(
					candidates.map(async (c) => {
						const dateStr = c.date.format("YYYY-MM-DD");
						const entry = byDay.get(dateStr);
						if (!entry) return;
						const tz = readTimezoneForEntry(this.app, entry);
						try {
							const photos = await getPhotosForDateString(
								this.app,
								dateStr,
								tz
							);
							results.push({
								label: c.label,
								entry,
								photos,
								dateStr,
								timeZone: tz,
								// keep original candidate ordering via date
								// We'll sort after
								_order: c.date.valueOf(),
							} as Period & { _order: number });
						} catch {
							// If fetching fails, still include entry with empty photos so text can be shown
							results.push({
								label: c.label,
								entry,
								photos: [],
								dateStr,
								timeZone: tz,
								_order: c.date.valueOf(),
							} as Period & { _order: number });
						}
					})
				);
				// Restore candidate order (30 days ago first, then 1y, 2y...)
				(results as (Period & { _order: number })[]).sort(
					(a, b) => b._order - a._order
				);
				this.periods = results;
			}

			this.render();
		})();
	}

	private render() {
		this.containerEl.empty();
		this.containerEl.addClass("journal-memories-view");

		if (this.periods.length === 0) {
			this.containerEl.createDiv({
				cls: "journal-memories-empty",
				text: "No matching entries from past anniversaries.",
			});
			return;
		}

		const carousel = this.containerEl.createDiv({
			cls: "journal-memories-carousel",
		});
		this.periods.forEach((period, index) => {
			this.renderCard(carousel, period, index);
		});
	}

	private renderCard(parent: HTMLElement, period: Period, index: number) {
		const card = parent.createDiv({ cls: "journal-memories-card" });
		card.addEventListener("click", () => {
			new MemoriesModal(
				this.app,
				this.plugin,
				this.periods,
				index
			).open();
		});

		const media = card.createDiv({ cls: "journal-memories-card-media" });
		const first = period.photos[0];
		if (first) {
			media.style.backgroundImage = `url("${first.thumbnailUrl}")`;
		} else {
			media.addClass("empty");
		}

		card.createDiv({
			cls: "journal-memories-card-caption",
			text: period.label,
		});
	}
}

interface Slide {
	period: Period;
	photo: ImmichPhoto | null;
}

class MemoriesModal extends Modal {
	private slides: Slide[] = [];
	private index = 0;
	private stageEl!: HTMLElement;
	private slideComponent = new Component();

	constructor(
		app: App,
		private plugin: JournalPlugin,
		private periods: Period[],
		startPeriod: number
	) {
		super(app);
		let startIndex = 0;
		for (let i = 0; i < periods.length; i++) {
			const period = periods[i];
			if (!period) continue;
			if (i === startPeriod) startIndex = this.slides.length;
			if (period.photos.length === 0) {
				this.slides.push({ period, photo: null });
			} else {
				for (const photo of period.photos) {
					this.slides.push({ period, photo });
				}
			}
		}
		this.index = startIndex;
	}

	onOpen() {
		this.modalEl.addClass("journal-memories-modal");
		const { contentEl } = this;
		contentEl.empty();

		this.stageEl = contentEl.createDiv({ cls: "journal-memories-stage" });

		const closeBtn = contentEl.createEl("button", {
			cls: "journal-memories-close",
			text: "×",
			attr: { "aria-label": "Close" },
		});
		closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
		closeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.close();
		});

		this.renderSlide();
	}

	onClose() {
		this.slideComponent.unload();
		this.contentEl.empty();
	}

	private renderSlide() {
		this.slideComponent.unload();
		this.slideComponent = new Component();
		this.slideComponent.load();
		this.stageEl.empty();
		const slide = this.slides[this.index];
		if (!slide) {
			this.close();
			return;
		}

		this.stageEl.createDiv({
			cls: "journal-memories-label",
			text: slide.period.label,
		});

		const media = this.stageEl.createDiv({ cls: "journal-memories-media" });
		this.attachGestures(media);

		if (slide.photo) {
			const img = media.createEl("img", { cls: "journal-memories-img" });
			// Prefer preview for HEIC handling, fallback to fullsize then thumbnail
			img.src =
				slide.photo.previewUrl ||
				slide.photo.fullsizeUrl ||
				slide.photo.thumbnailUrl;
		} else {
			media.addClass("text-only");
			const text = media.createDiv({
				cls: "journal-memories-text-slide",
			});
			void renderEntryTextBlock(
				this.app,
				text,
				slide.period.entry.file,
				this.slideComponent
			);
		}

		const openPanel = this.stageEl.createDiv({
			cls: "journal-memories-open-panel",
		});
		openPanel.addEventListener("pointerdown", (e) => e.stopPropagation());
		openPanel.addEventListener("click", (e) => {
			e.stopPropagation();
			void openEntry(this.app, slide.period.entry.file);
			this.close();
		});

		const lines = openPanel.createDiv({
			cls: "journal-memories-open-lines",
		});
		void renderEntryTextBlock(
			this.app,
			lines,
			slide.period.entry.file,
			this.slideComponent
		);
		openPanel.createDiv({
			cls: "journal-memories-open-cta",
			text: "Open note ›",
		});
	}

	private attachGestures(target: HTMLElement) {
		let startX = 0;
		let startY = 0;
		let pointerId: number | null = null;
		const SWIPE = 50;

		target.addEventListener("pointerdown", (e) => {
			pointerId = e.pointerId;
			startX = e.clientX;
			startY = e.clientY;
			target.setPointerCapture(e.pointerId);
		});

		target.addEventListener("pointerup", (e) => {
			if (pointerId !== e.pointerId) return;
			pointerId = null;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			const absX = Math.abs(dx);
			const absY = Math.abs(dy);

			if (absY > SWIPE && -dy > absX) {
				this.close();
				return;
			}
			if (absX > SWIPE) {
				if (dx < 0) this.advance(1);
				else this.advance(-1);
				return;
			}
			this.advance(1);
		});
	}

	private advance(delta: number) {
		const next = this.index + delta;
		if (next < 0) return;
		if (next >= this.slides.length) {
			this.close();
			return;
		}
		this.index = next;
		this.renderSlide();
	}
}
