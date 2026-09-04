import {
	App,
	BasesEntry,
	BasesView,
	Component,
	Modal,
	QueryController,
	Setting,
	moment as obsidianMoment,
} from "obsidian";
// eslint-disable-next-line no-restricted-imports
import type { Moment } from "moment";

const moment = obsidianMoment as unknown as typeof import("moment");
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

export const CALENDAR_VIEW_TYPE = "journal-calendar";

const MONTH_KEY = "viewedMonth";

export class CalendarBasesView extends BasesView {
	type = CALENDAR_VIEW_TYPE;

	private byDay = new Map<string, BasesEntry[]>();
	private viewedMonth: Moment = moment().startOf("month");
	private lazy: ReturnType<typeof createLazyObserver> | null = null;
	private thumbUrls = new Map<string, string | null>();
	private signature: string | null = null;

	constructor(
		controller: QueryController,
		private containerEl: HTMLElement,
		private plugin: JournalPlugin
	) {
		super(controller);
	}

	onDataUpdated(): void {
		const dateProp = this.plugin.settings.journalDateProperty;
		const byDay = new Map<string, BasesEntry[]>();
		for (const entry of this.data.data) {
			const m = parseEntryDate(this.app, entry, dateProp);
			if (!m) continue;
			const key = m.format("YYYY-MM-DD");
			const list = byDay.get(key);
			if (list) list.push(entry);
			else byDay.set(key, [entry]);
		}

		const stored = this.config.get(MONTH_KEY);
		if (typeof stored === "string") {
			const parsed = moment(stored, "YYYY-MM", true);
			if (parsed.isValid()) this.viewedMonth = parsed.startOf("month");
		}

		this.byDay = byDay;

		// Bases re-fires this on unrelated vault changes; rebuilding the grid
		// every time visibly flashes the whole month.
		if (this.computeSignature() === this.signature) return;
		this.render();
	}

	private computeSignature(): string {
		return [
			this.viewedMonth.format("YYYY-MM"),
			...[...this.byDay].map(
				([day, entries]) => `${day}=${entries.map((e) => e.file.path).join(",")}`
			),
		].join("|");
	}

	onunload() {
		this.lazy?.disconnect();
		this.lazy = null;
		super.onunload();
	}

	private render() {
		this.signature = this.computeSignature();
		this.containerEl.empty();
		this.containerEl.addClass("journal-calendar-view");

		this.lazy?.disconnect();
		this.lazy = createLazyObserver();

		this.renderToolbar(this.containerEl);
		this.renderGrid(this.containerEl);
	}

	private renderToolbar(parent: HTMLElement) {
		const toolbar = parent.createDiv({ cls: "journal-calendar-toolbar" });

		const prev = toolbar.createEl("button", {
			cls: "journal-calendar-nav",
			text: "‹",
			attr: { "aria-label": "Previous month" },
		});
		prev.addEventListener("click", () => this.changeMonth(-1));

		toolbar.createDiv({
			cls: "journal-calendar-month-label",
			text: this.viewedMonth.format("MMMM YYYY"),
		});

		const next = toolbar.createEl("button", {
			cls: "journal-calendar-nav",
			text: "›",
			attr: { "aria-label": "Next month" },
		});
		next.addEventListener("click", () => this.changeMonth(1));

		const jump = toolbar.createEl("button", {
			cls: "journal-calendar-jump",
			text: "Jump to date",
		});
		jump.addEventListener("click", () => {
			new JumpToDateModal(this.app, this.viewedMonth, (m) => {
				this.viewedMonth = m.clone().startOf("month");
				this.persistMonth();
				this.render();
			}).open();
		});
	}

	private renderGrid(parent: HTMLElement) {
		const grid = parent.createDiv({ cls: "journal-calendar-grid" });

		const weekdays = moment.weekdaysShort(true);
		for (const wd of weekdays) {
			grid.createDiv({ cls: "journal-calendar-weekday", text: wd });
		}

		const firstWeekday = moment.localeData().firstDayOfWeek();
		const monthStart = this.viewedMonth.clone();
		const gridStart = monthStart.clone();
		while (gridStart.day() !== firstWeekday) gridStart.subtract(1, "day");

		const monthEnd = monthStart.clone().endOf("month");
		const gridEnd = monthEnd.clone();
		const lastWeekday = (firstWeekday + 6) % 7;
		while (gridEnd.day() !== lastWeekday) gridEnd.add(1, "day");

		const cursor = gridStart.clone();
		while (cursor.isSameOrBefore(gridEnd, "day")) {
			this.renderDay(grid, cursor.clone(), monthStart);
			cursor.add(1, "day");
		}
	}

	private renderDay(
		grid: HTMLElement,
		day: Moment,
		monthStart: Moment
	) {
		const inMonth = day.isSame(monthStart, "month");
		const key = day.format("YYYY-MM-DD");
		const entries = this.byDay.get(key);
		const isToday = day.isSame(moment(), "day");

		const cell = grid.createDiv({ cls: "journal-calendar-day" });
		if (!inMonth) cell.addClass("muted");
		if (isToday) cell.addClass("today");

		if (entries && entries.length > 0) {
			cell.addClass("has-entry");
			cell.addEventListener("click", () => {
				if (entries.length === 1 && entries[0]) {
					void openEntry(this.app, entries[0].file);
				} else {
					new DayEntriesModal(
						this.app,
						this.plugin,
						day.clone(),
						entries
					).open();
				}
			});
			const cached = this.thumbUrls.get(key);
			if (cached !== undefined) {
				// Re-render (month nav, data refresh): paint from the known URL
				// instead of round-tripping through Immich again.
				if (cached) {
					setThumbnail(cell, cached, () => cell.addClass("has-image"));
				}
			} else {
				this.lazy?.observe(cell, () => {
					void (async () => {
						for (const entry of entries) {
							const photos = await getPhotosForEntry(
								this.app,
								entry
							);
							const url = photos[0]?.thumbnailUrl ?? null;
							if (url) {
								this.thumbUrls.set(key, url);
								setThumbnail(cell, url, () =>
									cell.addClass("has-image")
								);
								return;
							}
						}
						this.thumbUrls.set(key, null);
					})();
				});
			}
			if (entries.length > 1) {
				cell.createDiv({
					cls: "journal-calendar-day-count",
					text: String(entries.length),
				});
			}
		}

		cell.createDiv({ cls: "journal-calendar-day-num", text: String(day.date()) });
	}

	private changeMonth(delta: number) {
		this.viewedMonth = this.viewedMonth.clone().add(delta, "month");
		this.persistMonth();
		this.render();
	}

	private persistMonth() {
		this.config.set(MONTH_KEY, this.viewedMonth.format("YYYY-MM"));
	}
}

class DayEntriesModal extends Modal {
	private component = new Component();

	constructor(
		app: App,
		private plugin: JournalPlugin,
		private day: Moment,
		private entries: BasesEntry[]
	) {
		super(app);
	}

	onOpen() {
		this.component.load();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("journal-day-entries-modal");
		contentEl.createEl("h2", {
			text: this.day.format("MMM D, YYYY"),
		});

		const list = contentEl.createDiv({
			cls: "journal-day-entries-list",
		});
		for (const entry of this.entries) {
			const item = list.createDiv({
				cls: "journal-day-entries-item",
			});
			item.addEventListener("click", () => {
				void openEntry(this.app, entry.file);
				this.close();
			});
			const title = entryTitle(
				entry.file,
				this.plugin.settings.journalPrefixProperty
			);
			if (title) {
				item.createDiv({
					cls: "journal-day-entries-title",
					text: title,
				});
			}
			const preview = item.createDiv({
				cls: "journal-day-entries-preview",
			});
			// Same-day entries share the same photos, so keep the
		// picker preview text-only instead of repeating images.
		void renderEntryTextBlock(
				this.app,
				preview,
				entry.file,
				this.component,
				4,
				{ stripImages: true }
			);
		}
	}

	onClose() {
		this.component.unload();
		this.contentEl.empty();
	}
}

class JumpToDateModal extends Modal {
	private selectedMonth: number;
	private selectedYear: number;

	constructor(
		app: App,
		current: Moment,
		private onSubmit: (m: Moment) => void
	) {
		super(app);
		this.selectedMonth = current.month();
		this.selectedYear = current.year();
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Jump to date" });

		new Setting(contentEl).setName("Month").addDropdown((dd) => {
			moment.months().forEach((name, idx) => {
				dd.addOption(String(idx), name);
			});
			dd.setValue(String(this.selectedMonth));
			dd.onChange((v) => {
				this.selectedMonth = Number(v);
			});
		});

		new Setting(contentEl).setName("Year").addText((text) => {
			text.inputEl.type = "number";
			text.setValue(String(this.selectedYear));
			text.onChange((v) => {
				const n = Number(v);
				if (Number.isFinite(n)) this.selectedYear = n;
			});
		});

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText("Go")
				.setCta()
				.onClick(() => {
					this.onSubmit(
						moment({ year: this.selectedYear, month: this.selectedMonth, day: 1 })
					);
					this.close();
				})
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}
