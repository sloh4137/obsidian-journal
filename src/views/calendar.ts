import {
	App,
	BasesEntry,
	BasesView,
	Modal,
	QueryController,
	Setting,
	moment as obsidianMoment,
} from "obsidian";
// eslint-disable-next-line no-restricted-imports
import type { Moment } from "moment";

const moment = obsidianMoment as unknown as typeof import("moment");
import type JournalPlugin from "../main";
import { openEntry, parseEntryDate, getPhotosForEntry } from "./shared";

export const CALENDAR_VIEW_TYPE = "journal-calendar";

const MONTH_KEY = "viewedMonth";

export class CalendarBasesView extends BasesView {
	type = CALENDAR_VIEW_TYPE;

	private byDay = new Map<string, BasesEntry>();
	private viewedMonth: Moment = moment().startOf("month");

	constructor(
		controller: QueryController,
		private containerEl: HTMLElement,
		private plugin: JournalPlugin
	) {
		super(controller);
	}

	onDataUpdated(): void {
		const dateProp = this.plugin.settings.journalDateProperty;
		this.byDay.clear();
		for (const entry of this.data.data) {
			const m = parseEntryDate(this.app, entry, dateProp);
			if (m) this.byDay.set(m.format("YYYY-MM-DD"), entry);
		}

		const stored = this.config.get(MONTH_KEY);
		if (typeof stored === "string") {
			const parsed = moment(stored, "YYYY-MM", true);
			if (parsed.isValid()) this.viewedMonth = parsed.startOf("month");
		}

		this.render();
	}

	private render() {
		this.containerEl.empty();
		this.containerEl.addClass("journal-calendar-view");

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
		const entry = this.byDay.get(key);
		const isToday = day.isSame(moment(), "day");

		const cell = grid.createDiv({ cls: "journal-calendar-day" });
		if (!inMonth) cell.addClass("muted");
		if (isToday) cell.addClass("today");

		if (entry) {
			cell.addClass("has-entry");
			cell.addEventListener("click", () => {
				void openEntry(this.app, entry.file);
			});
			void getPhotosForEntry(this.app, entry).then((photos) => {
				const first = photos[0];
				if (!first) return;
				cell.addClass("has-image");
				cell.style.backgroundImage = `url("${first.thumbnailUrl}")`;
			});
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
