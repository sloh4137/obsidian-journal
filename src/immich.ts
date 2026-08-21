import { App, TFile, requestUrl } from "obsidian";

/**
 * Public types mirrored from obsidian-immich-memories for loose coupling.
 * The journal plugin depends only on the public API shape, not the implementation.
 */
export interface ImmichPhoto {
	assetId: string;
	thumbnailUrl: string;
	fullsizeUrl: string;
	previewUrl?: string;
	takenAt?: string;
	originalFileName?: string;
	type?: string;
	livePhotoVideoId?: string | null;
	// Extended with location when fetched via asset info (not in base public API)
	latitude?: number;
	longitude?: number;
}

export interface ImmichPublicApi {
	getPhotosForDate(dateStr: string, timeZone: string): Promise<ImmichPhoto[]>;
	findPhotos(dateStr: string, timeZone: string): Promise<ImmichPhoto[]>;
	getThumbnailUrl(assetId: string): string;
	getFullsizeUrl(assetId: string): string;
	getPreviewUrl(assetId: string): string;
	searchByDateRangeTaken(
		takenAfter: string,
		takenBefore: string
	): Promise<ImmichPhoto[]>;
	clearAssetCache(): Promise<void>;
	clearDateCache(): Promise<void>;
	getAssetCacheSizeMB(): number;
}

export interface ImmichMemoriesSettings {
	immichServerUrl: string;
	immichApiKey: string;
	dateField: string;
	timezoneField: string;
}

export const IMMICH_MEMORIES_PLUGIN_ID = "obsidian-immich-memories";
const DEFAULT_DATE_FIELD = "date";
const DEFAULT_TIMEZONE_FIELD = "timezone";

interface AppWithPlugins {
	plugins: {
		getPlugin(id: string): unknown;
	};
}

interface PluginWithApi {
	api?: ImmichPublicApi;
	settings?: Partial<ImmichMemoriesSettings>;
}

function getPluginInstance(app: App): PluginWithApi | null {
	const raw = (app as unknown as AppWithPlugins).plugins.getPlugin(
		IMMICH_MEMORIES_PLUGIN_ID
	);
	if (!raw || typeof raw !== "object") return null;
	return raw as PluginWithApi;
}

export function getImmichMemoriesApi(app: App): ImmichPublicApi | null {
	const plugin = getPluginInstance(app);
	return plugin?.api ?? null;
}

export function getImmichMemoriesSettings(app: App): ImmichMemoriesSettings {
	const plugin = getPluginInstance(app);
	const s = plugin?.settings;
	return {
		immichServerUrl: s?.immichServerUrl?.trim() ?? "",
		immichApiKey: s?.immichApiKey?.trim() ?? "",
		dateField:
			s?.dateField?.trim() && s.dateField.trim().length > 0
				? s.dateField.trim()
				: DEFAULT_DATE_FIELD,
		timezoneField:
			s?.timezoneField?.trim() && s.timezoneField.trim().length > 0
				? s.timezoneField.trim()
				: DEFAULT_TIMEZONE_FIELD,
	};
}

export function getImmichDateAndTimezoneFields(app: App): {
	dateField: string;
	timezoneField: string;
} {
	const { dateField, timezoneField } = getImmichMemoriesSettings(app);
	return { dateField, timezoneField };
}

type FrontmatterValue = string | number | boolean | Date | null | undefined;
type FrontmatterRecord = Record<string, FrontmatterValue>;

function extractFrontmatterValue(
	fm: FrontmatterRecord | undefined,
	fieldName: string
): string | undefined {
	if (!fm) return undefined;
	const direct = fm[fieldName];
	if (direct != null) {
		if (direct instanceof Date) return direct.toISOString();
		if (typeof direct === "string") {
			const trimmed = direct.trim();
			return trimmed ? trimmed : undefined;
		}
		return String(direct);
	}
	// case-insensitive fallback
	const lower = fieldName.toLowerCase();
	for (const k of Object.keys(fm)) {
		if (k.toLowerCase() === lower) {
			const v = fm[k];
			if (v == null) continue;
			if (v instanceof Date) return v.toISOString();
			if (typeof v === "string") {
				const t = v.trim();
				return t ? t : undefined;
			}
			return String(v);
		}
	}
	return undefined;
}

export function readDateAndTimezoneFromFrontmatter(
	app: App,
	file: TFile
): { dateStr: string | undefined; timeZone: string | undefined } {
	const cache = app.metadataCache.getFileCache(file);
	const fm = cache?.frontmatter as FrontmatterRecord | undefined;
	const { dateField, timezoneField } = getImmichDateAndTimezoneFields(app);
	const dateStr = extractFrontmatterValue(fm, dateField);
	const tz = extractFrontmatterValue(fm, timezoneField);
	return { dateStr, timeZone: tz };
}

export function parseDateOnlyString(value: string | undefined): string | undefined {
	if (!value) return undefined;
	// Accept YYYY-MM-DD prefix from ISO or date-only
	const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
	return m ? m[1] : undefined;
}

export async function getPhotosForFile(
	app: App,
	file: TFile
): Promise<ImmichPhoto[]> {
	const api = getImmichMemoriesApi(app);
	if (!api) return [];
	const { dateStr, timeZone } = readDateAndTimezoneFromFrontmatter(app, file);
	if (!dateStr) return [];
	return api.getPhotosForDate(dateStr, timeZone ?? "UTC");
}

export async function getPhotosForDateString(
	app: App,
	dateStr: string,
	timeZone?: string
): Promise<ImmichPhoto[]> {
	const api = getImmichMemoriesApi(app);
	if (!api) return [];
	if (!dateStr) return [];
	return api.getPhotosForDate(dateStr, timeZone ?? "UTC");
}

export interface LatLng {
	latitude: number;
	longitude: number;
}

/**
 * Fetch lat/lng for an asset via Immich server API.
 * The public memories API doesn't expose location, so we use the memories plugin's
 * configured serverUrl/apiKey directly. This restores the "set coordinates from immich"
 * command that previously used hash→latLng.
 */
export async function fetchLatLngForAsset(
	app: App,
	assetId: string
): Promise<LatLng | null> {
	const { immichServerUrl, immichApiKey } = getImmichMemoriesSettings(app);
	if (!immichServerUrl || !immichApiKey || !assetId) return null;
	const base = immichServerUrl.replace(/\/+$/, "");
	const url = `${base}/api/assets/${encodeURIComponent(assetId)}`;
	try {
		const res = await requestUrl({
			url,
			method: "GET",
			headers: {
				"x-api-key": immichApiKey,
			},
			throw: false,
		});
		if (res.status < 200 || res.status >= 300) return null;
		const json = res.json as Record<string, unknown> | undefined;
		if (!json) return null;
		// exifInfo may be nested
		const exif = json.exifInfo as Record<string, unknown> | undefined;
		if (!exif) return null;
		const lat = exif.latitude;
		const lon = exif.longitude;
		if (typeof lat === "number" && typeof lon === "number") {
			return { latitude: lat, longitude: lon };
		}
		return null;
	} catch {
		return null;
	}
}

export async function getLatLngForPhotos(
	app: App,
	photos: ImmichPhoto[]
): Promise<LatLng | null> {
	// First check if photo object already carries lat/lng (future-proof)
	for (const p of photos) {
		if (
			typeof p.latitude === "number" &&
			typeof p.longitude === "number"
		) {
			return { latitude: p.latitude, longitude: p.longitude };
		}
	}
	// Otherwise fetch via asset info
	for (const p of photos) {
		const ll = await fetchLatLngForAsset(app, p.assetId);
		if (ll) return ll;
	}
	return null;
}
