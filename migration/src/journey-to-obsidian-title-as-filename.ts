import { promises as fs } from "node:fs";
import * as path from "node:path";
import { DateTime } from "luxon";
import TurndownService from "turndown";

type JourneyJson = {
	date_journal: number;
	date_modified: number;
	timezone: string;
	text: string;
	mood?: number;
	sentiment?: number;
	lat?: number;
	lon?: number;
	favourite?: boolean;
	photos?: string[];
};

const SENTIMENT_MAP: Record<string, number> = {
	"0.25": -3,
	"0.75": -2,
	"1": -1,
	"0": 0,
	"1.25": 1,
	"1.75": 2,
	"2": 3,
};

// Characters Obsidian (and most filesystems) disallow in a note file name.
const INVALID_FILENAME_CHARS = /[*"\\/<>:|?]/;

function parseTimestampFieldWithTimezone(
	json: JourneyJson,
	jsonField: keyof JourneyJson,
	format: string
): string {
	const ms = json[jsonField] as number;
	return DateTime.fromMillis(ms, { zone: json.timezone }).toFormat(format);
}

function mapSentiment(json: JourneyJson): number {
	const value = Math.max(json.mood ?? 0, json.sentiment ?? 0);
	return SENTIMENT_MAP[String(value)] ?? 0;
}

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&nbsp;/g, " ");
}

const LEADING_H1 = /^\s*<h1[^>]*>(.*?)<\/h1>/i;

/**
 * If the body's very first element is an <h1>, return its (decoded) text as the
 * note title. Otherwise return null so the caller falls back to the date only.
 */
function extractH1Title(text: string): string | null {
	const match = LEADING_H1.exec(text);
	if (!match) return null;
	// Strip any nested inline tags, then decode entities.
	const inner = match[1].replace(/<[^>]+>/g, "");
	const title = decodeHtmlEntities(inner).trim();
	return title.length > 0 ? title : null;
}

function buildFrontmatter(json: JourneyJson): string {
	const journalDate = parseTimestampFieldWithTimezone(
		json,
		"date_journal",
		"yyyy-LL-dd"
	);
	const journalTime = parseTimestampFieldWithTimezone(
		json,
		"date_journal",
		"yyyy-LL-dd'T'HH:mm:ss"
	);
	const modifiedStr = parseTimestampFieldWithTimezone(
		json,
		"date_modified",
		"yyyy-LL-dd'T'HH:mm:ss"
	);

	const lines: string[] = [];
	lines.push(`journalDate: ${journalDate}`);
	lines.push(`journalTime: ${journalTime}`);
	lines.push(`createdTime: ${modifiedStr}`);
	lines.push(`modifiedTime: ${modifiedStr}`);
	lines.push(`timeZone: ${json.timezone}`);
	lines.push(`coordinates: ${json.lat ?? ""}, ${json.lon ?? ""}`);
	lines.push(`sentiment: ${mapSentiment(json)}`);
	lines.push(`isFavorite: ${json.favourite ?? false}`);
	lines.push(`tags:\n    - "#journal"`);
	lines.push(`cssclasses:\n    - journal\n    - immichBanner`);
	return lines.join("\n");
}

async function resolveOutputPath(
	outputDir: string,
	baseName: string
): Promise<string> {
	let candidate = path.join(outputDir, `${baseName}.md`);
	let counter = 1;
	while (await fileExists(candidate)) {
		candidate = path.join(outputDir, `${baseName} ${counter}.md`);
		counter += 1;
	}
	return candidate;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Convert a single entry. Returns the offending base name if it contains
 * characters that are invalid in a filename (in which case nothing is written),
 * or null on success.
 */
async function convertEntry(
	jsonPath: string,
	outputDir: string,
	turndown: TurndownService
): Promise<string | null> {
	const raw = await fs.readFile(jsonPath, "utf8");
	const json: JourneyJson = JSON.parse(raw);

	const dateStr = parseTimestampFieldWithTimezone(
		json,
		"date_journal",
		"yyyy-LL-dd"
	);
	const title = extractH1Title(json.text ?? "");
	let baseName = title ? `${dateStr} ${title}` : dateStr;

	// Colons are invalid in filenames: "1:1" reads better as "1-1"; any other
	// colon becomes ")".
	let prevBaseName = baseName;
	baseName = baseName
		.replace(/1:1/g, "1-1")
		.replace(/:/g, ")")
		.replace(/\?/, "")
		.replace(/\//, "-");
	while (prevBaseName != baseName) {
		prevBaseName = baseName;
		baseName = baseName
			.replace(/1:1/g, "1-1")
			.replace(/:/g, ")")
			.replace(/\?/, "")
			.replace(/\//, "-");
	}

	if (INVALID_FILENAME_CHARS.test(baseName)) {
		return baseName;
	}

	const outputPath = await resolveOutputPath(outputDir, baseName);

	// When the leading <h1> becomes the note title, drop it from the body so it
	// isn't duplicated.
	const bodyHtml = title
		? (json.text ?? "").replace(LEADING_H1, "")
		: json.text ?? "";

	const frontmatter = buildFrontmatter(json);
	const body = turndown.turndown(bodyHtml);
	const contents = `---\n${frontmatter}\n---\n${body}\n`;

	await fs.writeFile(outputPath, contents, "utf8");
	console.log(`${path.basename(jsonPath)} -> ${path.basename(outputPath)}`);
	return null;
}

async function main(): Promise<void> {
	const [inputDir, outputDir] = process.argv.slice(2);
	if (!inputDir || !outputDir) {
		console.error(
			"Usage: tsx src/journey-to-obsidian-title-as-filename.ts <input-dir> <output-dir>"
		);
		process.exit(1);
	}

	await fs.mkdir(outputDir, { recursive: true });
	const entries = await fs.readdir(inputDir);
	const jsonFiles = entries.filter((name) => name.endsWith(".json")).sort();

	const turndown = new TurndownService({ headingStyle: "atx" });

	const invalid: string[] = [];
	for (const filename of jsonFiles) {
		const badName = await convertEntry(
			path.join(inputDir, filename),
			outputDir,
			turndown
		);
		if (badName) invalid.push(`${filename} -> "${badName}"`);
	}

	const written = jsonFiles.length - invalid.length;
	console.log(`Converted ${written} entries -> ${outputDir}`);

	if (invalid.length > 0) {
		console.log(
			`\n${invalid.length} entr${
				invalid.length === 1 ? "y" : "ies"
			} skipped due to invalid filename characters (${
				INVALID_FILENAME_CHARS.source
			}):`
		);
		for (const line of invalid) console.log(`  ${line}`);
		process.exit(1);
	}
}

void main();
