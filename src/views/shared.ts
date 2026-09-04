import {
	App,
	BasesEntry,
	Component,
	MarkdownRenderer,
	TFile,
	moment as obsidianMoment,
} from "obsidian";
// eslint-disable-next-line no-restricted-imports
import type { Moment } from "moment";

const moment = obsidianMoment as unknown as typeof import("moment");
import {
	ImmichPhoto,
	getPhotosForFile,
	getPhotosForDateString,
	getImmichDateAndTimezoneFields,
} from "../immich";

export function readFrontmatter(
	app: App,
	file: TFile
): Record<string, unknown> | undefined {
	return app.metadataCache.getFileCache(file)?.frontmatter as
		| Record<string, unknown>
		| undefined;
}

export function parseEntryDate(
	app: App,
	entry: BasesEntry,
	dateProp: string
): Moment | null {
	const raw = readFrontmatter(app, entry.file)?.[dateProp];
	if (raw == null) return null;
	if (raw instanceof Date) {
		const m = moment(raw);
		return m.isValid() ? m : null;
	}
	if (typeof raw === "string") {
		const m = moment(raw);
		return m.isValid() ? m : null;
	}
	return null;
}

/**
 * New Immich Memories based helpers.
 * Photos are fetched via getPhotosForDate using the memories plugin's configured date/timezone fields.
 */

export async function getPhotosForEntry(
	app: App,
	entry: BasesEntry
): Promise<ImmichPhoto[]> {
	return getPhotosForFile(app, entry.file);
}

export async function getFirstPhotoForEntry(
	app: App,
	entry: BasesEntry
): Promise<ImmichPhoto | undefined> {
	const photos = await getPhotosForEntry(app, entry);
	return photos[0];
}

export async function getPhotosForDate(
	app: App,
	dateStr: string,
	timeZone?: string
): Promise<ImmichPhoto[]> {
	return getPhotosForDateString(app, dateStr, timeZone ?? "UTC");
}

/**
 * Read timezone frontmatter value for an entry using memories plugin settings.
 * Falls back to UTC.
 */
export function readTimezoneForEntry(
	app: App,
	entry: BasesEntry
): string {
	const fm = readFrontmatter(app, entry.file);
	const { timezoneField } = getImmichDateAndTimezoneFields(app);
	if (!fm) return "UTC";
	const raw: unknown =
		fm[timezoneField] ??
		fm[timezoneField.toLowerCase()] ??
		fm["timeZone"] ??
		fm["timezone"];
	if (raw == null) return "UTC";
	if (raw instanceof Date) return "UTC";
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		return trimmed ? trimmed : "UTC";
	}
	if (typeof raw === "number" || typeof raw === "boolean") {
		return String(raw);
	}
	return "UTC";
}

function stripFrontmatter(raw: string): string {
	if (!raw.startsWith("---")) return raw;
	const end = raw.indexOf("\n---", 3);
	if (end < 0) return raw;
	const after = raw.indexOf("\n", end + 4);
	return after < 0 ? "" : raw.slice(after + 1);
}

export function entryTitle(file: TFile, prefix?: string): string {
	let name = file.basename;
	// Optionally strip a configured prefix (e.g. "Journal ") for backwards compatibility
	if (prefix && name.startsWith(prefix)) {
		name = name.slice(prefix.length);
	}
	// Spec: take filename, subtract date "YYYY-MM-DD " and use remainder as title
	const withSpace = name.match(/^\d{4}-\d{2}-\d{2}\s+(.*)$/);
	if (withSpace) {
		return (withSpace[1] ?? "").trim();
	}
	// Fallback: date without trailing space (e.g. "YYYY-MM-DDTitle" or just date)
	if (/^\d{4}-\d{2}-\d{2}/.test(name)) {
		return name.slice(10).trim();
	}
	return name;
}

export function createLazyObserver(rootMargin = "300px"): {
	observe(el: HTMLElement, fn: () => void): void;
	disconnect(): void;
} {
	const callbacks = new WeakMap<Element, () => void>();
	const observer = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				const fn = callbacks.get(e.target);
				callbacks.delete(e.target);
				observer.unobserve(e.target);
				fn?.();
			}
		},
		{ rootMargin }
	);
	return {
		observe(el, fn) {
			callbacks.set(el, fn);
			observer.observe(el);
		},
		disconnect() {
			observer.disconnect();
		},
	};
}

/**
 * Inserts a covering thumbnail only once it has decoded, so the container goes
 * straight from its placeholder to the photo in one paint instead of flashing
 * an intermediate state. Does nothing if the image fails to load.
 */
export function setThumbnail(
	parent: HTMLElement,
	url: string,
	onReady?: () => void
): void {
	const img = new Image();
	img.addClass("journal-thumb");
	img.decoding = "async";
	img.src = url;
	const insert = () => {
		parent.prepend(img);
		onReady?.();
	};
	if (img.complete) {
		insert();
		return;
	}
	img.decode().then(insert, () => {
		/* broken image: leave the placeholder in place */
	});
}

const IMAGE_EXTENSIONS = "png|jpe?g|gif|bmp|svg|webp|heic|heif|avif|tiff?";

/**
 * Remove image markup from markdown so previews stay text-only.
 * Covers inline images, Obsidian image embeds, and raw <img> tags.
 */
export function stripImages(markdown: string): string {
	return markdown
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(
			new RegExp(`!\\[\\[[^\\]]+\\.(${IMAGE_EXTENSIONS})(\\|[^\\]]*)?\\]\\]`, "gi"),
			""
		)
		.replace(/<img\b[^>]*>/gi, "");
}

export async function renderEntryTextBlock(
	app: App,
	parent: HTMLElement,
	file: TFile,
	component: Component,
	maxLines = 10,
	options?: { stripImages?: boolean }
): Promise<HTMLElement> {
	const block = parent.createDiv({ cls: "journal-text-block" });

	const body = block.createDiv({ cls: "journal-text-block-body" });
	const raw = await app.vault.cachedRead(file);
	const stripped = stripFrontmatter(raw).trim();
	if (stripped) {
		let truncated = stripped.split("\n").slice(0, maxLines).join("\n");
		if (options?.stripImages) truncated = stripImages(truncated);
		await MarkdownRenderer.render(
			app,
			truncated,
			body,
			file.path,
			component
		);
	}
	return block;
}

export async function openEntry(app: App, file: TFile): Promise<void> {
	await app.workspace.getLeaf(false).openFile(file);
}
