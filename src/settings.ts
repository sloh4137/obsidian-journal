import {
	AbstractInputSuggest,
	App,
	PluginSettingTab,
	Setting,
	TFolder,
} from "obsidian";
import JournalPlugin from "./main";

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private inputEl: HTMLInputElement,
		private onSelectFolder: (path: string) => void
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): TFolder[] {
		const lowerQuery = query.toLowerCase();
		return this.app.vault
			.getAllFolders(true)
			.filter((folder) => folder.path.toLowerCase().includes(lowerQuery));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path === "/" ? "/" : folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		const value = folder.path === "/" ? "" : folder.path;
		this.inputEl.value = value;
		this.inputEl.trigger("input");
		this.onSelectFolder(value);
		this.close();
	}
}

export interface JournalPluginSettings {
	journalDateProperty: string;
	journalEntriesFolder: string;
	journalPrefixProperty: string;
}

export const DEFAULT_SETTINGS: JournalPluginSettings = {
	journalDateProperty: "journalDate",
	journalEntriesFolder: "",
	journalPrefixProperty: "Journal ",
};

export class JournalSettingTab extends PluginSettingTab {
	plugin: JournalPlugin;

	constructor(app: App, plugin: JournalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Journal entries folder")
			.setDesc(
				"Vault-relative folder containing journal entries. Listeners and journal commands only act on files in this folder. Leave empty to act on all files."
			)
			.addText((text) => {
				text.setPlaceholder("Journal")
					.setValue(this.plugin.settings.journalEntriesFolder)
					.onChange(async (value) => {
						this.plugin.settings.journalEntriesFolder = value;
						await this.plugin.saveSettings();
					});
				new FolderSuggest(this.app, text.inputEl, (value) => {
					this.plugin.settings.journalEntriesFolder = value;
					void this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Entry date property")
			.setDesc("Frontmatter property name that holds the entry's date.")
			.addText((text) =>
				text
					.setPlaceholder("journalDate")
					.setValue(this.plugin.settings.journalDateProperty)
					.onChange(async (value) => {
						this.plugin.settings.journalDateProperty = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Journal entry prefix")
			.setDesc(
				"String prefix at the beginning of a journal entry file name. Will be ignored when replacing the date."
			)
			.addText((text) =>
				text
					.setPlaceholder("")
					.setValue(this.plugin.settings.journalPrefixProperty)
					.onChange(async (value) => {
						this.plugin.settings.journalPrefixProperty = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
