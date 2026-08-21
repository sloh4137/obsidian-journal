# Journal

An opinionated journaling plugin for Obsidian that follows [Journey](https://journey.cloud/)'s approach to journaling: one note per day, with date, timezone, location, photos, and a few lines of text per entry.

The plugin adds three custom [Bases](https://help.obsidian.md/bases) views (Entries, Calendar, Memories), commands for stamping coordinates from device GPS or from [Immich](https://immich.app) photos, and integrates with [Obsidian Immich Memories](https://github.com/anomalyco/obsidian-immich-memories) (`getPhotosForDate` public API) to resolve thumbnails.

## Features

### Bases views

These views require Obsidian's [Bases](https://help.obsidian.md/bases) core plugin to be enabled. They are designed to be used as views on a Base that filters down to your journal entries (e.g. by folder or tag).

#### Entries — `journal-entries`

Vertical, paginated feed of journal entries sorted by `journalDate` descending (newest first) with infinite scroll (IntersectionObserver + 7-item pages).

Each card shows:
- **Date header** — formatted as `MMM D, YYYY | dddd` from `journalDate` frontmatter.
- **Title** — extracted from the filename by subtracting the leading date. Convention is `YYYY-MM-DD My Title` → `My Title`. Optional configured prefix (default `Journal `) is stripped first for backwards compatibility. If the filename is date-only, no title is shown.
- **Body preview** — markdown-rendered note body (frontmatter stripped, up to 200 lines, overflow hidden) via `MarkdownRenderer`.
- **Thumbnail** — first Immich photo for that entry's date/timezone (`getPhotosForFile` → `getPhotosForDate`), rendered as a square background image. Cards without photos get `no-image` styling and expanded text.

Clicking a card opens the underlying file.

Source: `src/views/entries.ts`, `src/views/shared.ts:entryTitle`, `src/views/shared.ts:renderEntryTextBlock`, `src/immich.ts:getPhotosForFile`

#### Calendar — `journal-calendar`

Month grid with one cell per day:
- Days with an entry are tinted (`has-entry`); days that also have an Immich photo use the photo as cell background (`has-image`).
- Today is outlined, out-of-month days are muted.
- Clicking a day with an entry opens that entry.
- Toolbar with prev/next month chevrons and a **Jump to date** modal (month dropdown + year input).
- Viewed month is persisted per view via `this.config` (`viewedMonth` → `YYYY-MM`).

Source: `src/views/calendar.ts`

#### Memories — `journal-memories`

Horizontal carousel of past anniversaries that have an entry on the same calendar day:
- Candidates: `30 days ago`, `1 year ago`, `2 years ago`, … up to the oldest entry's year.
- Each card shows the period label (e.g. `2 years ago`) and the first Immich photo as background, or an empty dashed placeholder.
- Tapping a card opens a full-screen, swipeable slideshow modal (`MemoriesModal`):
  - Each slide is either an Immich photo (prefers `previewUrl`, falls back to `fullsizeUrl` / `thumbnailUrl`) or text-only fallback when no photos exist.
  - Gestures: swipe left/right to advance, swipe up to close, click media to advance, close button.
  - Bottom panel shows truncated text preview (`renderEntryTextBlock`) and **Open note ›** CTA that opens the underlying file.
  - Photos are fetched per anniversary date via `getPhotosForDateString(dateStr, timeZone)` where timezone is read from frontmatter using Immich Memories' configured `timezoneField`.

Source: `src/views/memories.ts`

### Photo resolution via Immich Memories

All thumbnail and slideshow photos come from the **Immich Memories** plugin:

- Plugin ID: `obsidian-immich-memories`.
- Public API `getPhotosForDate(dateStr, timeZone)` is accessed via `app.plugins.plugins['obsidian-immich-memories'].api`.
- Date and timezone are read from frontmatter using the field names configured in **Settings → Immich Memories** (defaults: `date` and `timezone`). The journal plugin reads those fields with case-insensitive fallback and supports `timeZone` / `timezone` / `timeZone` variants.
- `getPhotosForFile` and `getPhotosForDateString` in `src/immich.ts` wrap the public API with `UTC` fallback.
- EXIF lat/lng for the **Set coordinates from Immich memories** command is not part of the public API, so the plugin calls Immich directly (`GET /api/assets/{id}`) using `immichServerUrl` / `immichApiKey` from Immich Memories settings.

Source: `src/immich.ts`

### Commands

- **Set coordinates from device location** (`set-coordinates-from-device-gps`) — writes the device's current GPS latitude/longitude into the active note's `coordinates` frontmatter as `"lat, lon"`. Respects `journalEntriesFolder` setting when deciding if a file is a journal file (used for listeners, but command checks active file). Shows `Notice` on success/failure.
- **Set coordinates from Immich memories** (`set-coordinates-from-immich-images`) — fetches photos for the active file's date via `getPhotosForFile`, then looks up EXIF lat/lon via Immich asset API and writes the first found coordinates into `coordinates`.

Both commands are registered in `src/main.ts` and `src/frontmatter.ts:updateCoordinates`.

### Automatic behaviors

#### Journal time watcher

On any `metadataCache.on("changed")` event inside the configured journal folder:

1. Extracts `journalTime` (or `YYYY-MM-DD` prefix) from frontmatter.
2. If it differs from current `journalDate` property (setting: `journalDateProperty`, default `journalDate`), updates that frontmatter field.
3. Renames the file if basename starts with a date: `YYYY-MM-DD*` → new date + rest of name, preserving title. Example: `2024-01-01 My Day.md` → `2024-02-03 My Day.md` when `journalTime` changes to `2024-02-03`.

Source: `src/main.ts:handleJournalTimeChange`, `extractDate`

#### Title extraction

`entryTitle(file, prefix?)` in `src/views/shared.ts`:

```ts
// Spec: filename minus "YYYY-MM-DD "
"2025-08-21 My awesome day" → "My awesome day"
"2025-08-21" → "" (no title)
```

If a `journalPrefixProperty` (e.g. `Journal `) is configured and the basename starts with it, that prefix is stripped before date parsing. The Entries view shows this title as `journal-entry-card-title` (bold, ellipsis truncated).

## Settings

Configurable via **Settings → Community plugins → Journal**:

- **Journal entries folder** — vault-relative folder containing entries. Listeners (`handleJournalTimeChange`) and folder checks only act on files inside this folder. Leave empty to act on all files. Has folder autocomplete via `FolderSuggest`.
- **Entry date property** — frontmatter property name that holds the canonical entry date for sorting/grouping in Bases views. Default: `journalDate`. Note: Immich photo lookup uses Immich Memories' `dateField`/`timezoneField`, not this property.
- **Journal entry prefix** — string prefix at the beginning of a journal entry filename that is ignored when deriving the title. Default: `Journal `. Example: `Journal 2025-08-21 Trip` → title `Trip`.

Defaults in `src/settings.ts:DEFAULT_SETTINGS`.

## Entry naming convention

Expected filename format:

```
YYYY-MM-DD Optional title.md
```

- Date prefix is used for display fallback and auto-rename.
- Title is everything after `YYYY-MM-DD ` (space). The Entries view card extracts and shows this title.
- If you use a prefix like `Journal `, configure it in settings so title extraction strips it first.

## Entry template

`journal-entry-template.md` is a [Templater](https://github.com/SilentVoid13/Templater) template:

```yaml
---
createdTime: <% tp.file.creation_date() %>
journalDate: <% tp.date.now() %>
journalTime: <% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>
timeZone: <% Intl.DateTimeFormat().resolvedOptions().timeZone %>
coordinates:
sentiment:
isFavorite:
tags:
    - "#journal"
cssclasses:
    - journal
    - immichBanner
---

<%_ await tp.file.rename(tp.date.now("YYYY-MM-DD")) %>
<%_ await app.commands.executeCommandById("obsidian-journal:set-coordinates-from-device-gps") %>
```

It sets up frontmatter (`journalDate`, `journalTime`, `timeZone`, `coordinates`, `sentiment`, `isFavorite`, `#journal`, `journal` + `immichBanner` cssclasses), renames the file to current date, and triggers device GPS stamping.

Modify `immichBanner` class in your CSS/snippets as desired for photo banners.

## Development

```bash
npm install
npm run dev      # watch build via esbuild
npm run build    # production build: tsc -noEmit -skipLibCheck + esbuild
npm run lint     # eslint with obsidianmd plugin
```

Build output is bundled to `main.js` at the repo root alongside `manifest.json` and `styles.css` (required release artifacts). Source lives in `src/`:

```
src/
  main.ts           # Plugin lifecycle, commands, journalTime watcher, Bases view registration
  settings.ts       # Settings interface, defaults, FolderSuggest, settings tab
  frontmatter.ts    # updateCoordinates helper
  immich.ts         # Public API wrapper for Immich Memories, lat/lng fetch
  views/
    shared.ts       # parseEntryDate, readTimezoneForEntry, entryTitle, renderEntryTextBlock, openEntry, photos helpers
    entries.ts      # EntriesBasesView — paginated feed with title + body + thumbnail
    calendar.ts     # CalendarBasesView — month grid + jump modal
    memories.ts     # MemoriesBasesView — anniversary carousel + full-screen slideshow modal
```

### Installing locally

Symlink or copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/obsidian-journal/`, then enable the plugin in **Settings → Community plugins** and enable **Bases** core plugin.

## Migration from Journey

The `migration/` directory contains one-off scripts that convert a Journey export (JSON per entry) into Obsidian-compatible Markdown notes:

- `src/journey-to-obsidian.ts` — converts each JSON to `YYYY-MM-DD.md` with frontmatter (`journalDate`, `journalTime`, `createdTime`, `modifiedTime`, `timeZone`, `coordinates`, `sentiment`, `isFavorite`, tags, cssclasses) and body via Turndown.
- `src/journey-to-obsidian-title-as-filename.ts` — same, but extracts leading `<h1>` from Journey HTML text as title: `YYYY-MM-DD Title.md`. Drops the `<h1>` from body, sanitizes colons (`1:1` → `1-1`, `:` → `)`), skips files with invalid filename chars (`*"<>\/:|?`) and reports them.

Both upload? Original version had Immich upload logic removed — current scripts preserve structure only. See `migration/package.json` for `tsx` runner and `migration/.env.example` for setup. Output dir will contain converted Markdown files.

## License

[0BSD](LICENSE)
