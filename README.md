# Journal

An opinionated journaling plugin for Obsidian that follows [Journey](https://journey.cloud/)'s approach to journaling: one note per day, with date, location, photos, and a few lines of text per entry.

The plugin adds three custom [Bases](https://help.obsidian.md/bases) views (Entries, Calendar, Memories), commands for stamping the entry's coordinates from device GPS or from [Immich](https://immich.app) photos, and integrates with the [Obsidian Immich Memories](https://github.com/anomalyco/obsidian-immich-memories) plugin's public API (`getPhotosForDate`) to resolve thumbnails.

## Features

### Bases views

These views require Obsidian's [Bases](https://help.obsidian.md/bases) core plugin to be enabled. They are designed to be used as views on a Base that filters down to your journal entries.

- **Entries** — vertical, paginated feed of journal entries sorted by date (newest first). Each card shows the date, the first two non-empty lines of the note, and a thumbnail of the first Immich photo for that date (via `getPhotosForDate`).
- **Calendar** — month grid with one cell per day. Days with an entry are tinted; days that also have an Immich photo use the photo as the cell background. Includes prev/next month navigation and a "jump to date" modal. The viewed month is persisted per view.
- **Memories** — horizontal carousel of past anniversaries (30 days ago, 1 year ago, 2 years ago, …) that have an entry on the same calendar day. Tapping a card opens a full-screen, swipeable slideshow of Immich photos taken on that calendar day (fetched via `getPhotosForDate` using the entry's timezone).

Photos are resolved via the **Immich Memories** plugin:

- Date and timezone are read from the frontmatter fields configured in **Settings → Immich Memories** (defaults: `date` and `timezone`). The journal plugin reads those same field names from each journal file and calls `app.plugins.plugins['obsidian-immich-memories'].api.getPhotosForDate(date, timezone)`.
- Thumbnails and full-size URLs come directly from `ImmichPhoto.thumbnailUrl` / `fullsizeUrl` / `previewUrl`, with local asset-cache support handled by the memories plugin.

### Commands

- **Set coordinates from device location** — writes the device's current GPS latitude/longitude into the active note's `coordinates` frontmatter.
- **Set coordinates from immich memories** — fetches photos for the current note's date via `getPhotosForDate`, then looks up EXIF latitude/longitude from Immich (`GET /api/assets/{id}` using the server URL/API key from Immich Memories settings) and writes the first found coordinates into `coordinates`.

## Settings

- **Journal entries folder** — vault-relative folder containing your entries. Listeners and journal commands only act on files inside this folder. Leave empty to act on all files.
- **Entry date property** — frontmatter property name that holds the entry's date for sorting/grouping inside Bases views. Default: `journalDate`. The Immich photo lookup uses the **Immich Memories** plugin's `dateField`/`timezoneField` settings instead.
- **Journal entry prefix** — string prefix ignored when parsing entry file names for titles.

## Entry template

`journal-entry-template.md` is a [Templater](https://github.com/SilentVoid13/Templater) template for new entries. It sets up the expected frontmatter (`journalDate`, `journalTime`, `date`, `timezone`, `timeZone`, `coordinates`, `sentiment`, `isFavorite`, tags, css classes), renames the file to the current date, and runs the device-GPS command.

## Development

```bash
npm install
npm run dev      # watch build
npm run build    # production build (typecheck + bundle)
npm run lint
```

Built output is bundled to `main.js` at the repo root alongside `manifest.json` and `styles.css`.

### Installing locally

Symlink or copy `main.js`, `manifest.json`, and `styles.css` into `<Vault>/.obsidian/plugins/obsidian-journal/`, then enable the plugin in **Settings → Community plugins**.

## Migration from Journey

The `migration/` directory contains a one-off script that converts a Journey export into Obsidian-compatible Markdown notes, uploading any attached photos to Immich and recording the resulting asset hashes in frontmatter. See `migration/README.md` and `migration/.env.example` for setup.

## License

[0BSD](LICENSE)
