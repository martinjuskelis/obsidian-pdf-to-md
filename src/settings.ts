import { App, PluginSettingTab, Setting } from "obsidian";
import type PdfToMdPlugin from "./main";

export type Provider = "replicate" | "modal";
export type MarkerMode = "fast" | "balanced" | "accurate";

export interface PdfToMdSettings {
	provider: Provider;

	// Replicate
	replicateApiToken: string;

	// Modal
	modalEndpoint: string;
	modalApiKey: string;

	// Marker parameters
	mode: MarkerMode;
	forceOcr: boolean;
	useLlm: boolean;
	paginateOutput: boolean;
	stripExistingOcr: boolean;
	formatLines: boolean;
	disableImageExtraction: boolean;
	pageRange: string;
}

export const DEFAULT_SETTINGS: PdfToMdSettings = {
	provider: "replicate",
	replicateApiToken: "",
	modalEndpoint: "",
	modalApiKey: "",
	mode: "balanced",
	forceOcr: false,
	useLlm: false,
	paginateOutput: false,
	stripExistingOcr: false,
	formatLines: false,
	disableImageExtraction: false,
	pageRange: "",
};

export class PdfToMdSettingTab extends PluginSettingTab {
	plugin: PdfToMdPlugin;

	constructor(app: App, plugin: PdfToMdPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// --- Provider ---

		new Setting(containerEl)
			.setName("Provider")
			.setDesc("Which API provider to use for PDF conversion.")
			.addDropdown((dd) =>
				dd
					.addOption("replicate", "Replicate")
					.addOption("modal", "Modal")
					.setValue(this.plugin.settings.provider)
					.onChange(async (value) => {
						this.plugin.settings.provider = value as Provider;
						await this.plugin.saveSettings();
						this.display(); // re-render to show/hide provider sections
					})
			);

		// --- Replicate settings ---

		if (this.plugin.settings.provider === "replicate") {
			containerEl.createEl("h3", { text: "Replicate" });

			new Setting(containerEl)
				.setName("API token")
				.setDesc("Your Replicate API token.")
				.addText((text) =>
					text
						.setPlaceholder("r8_...")
						.setValue(this.plugin.settings.replicateApiToken)
						.onChange(async (value) => {
							this.plugin.settings.replicateApiToken = value.trim();
							await this.plugin.saveSettings();
						})
				);
		}

		// --- Modal settings ---

		if (this.plugin.settings.provider === "modal") {
			containerEl.createEl("h3", { text: "Modal" });

			new Setting(containerEl)
				.setName("Endpoint URL")
				.setDesc("The URL of your Modal Marker deployment.")
				.addText((text) =>
					text
						.setPlaceholder("https://your--marker.modal.run")
						.setValue(this.plugin.settings.modalEndpoint)
						.onChange(async (value) => {
							this.plugin.settings.modalEndpoint = value.trim();
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName("API key")
				.setDesc("Optional API key for your Modal endpoint.")
				.addText((text) =>
					text
						.setPlaceholder("key")
						.setValue(this.plugin.settings.modalApiKey)
						.onChange(async (value) => {
							this.plugin.settings.modalApiKey = value.trim();
							await this.plugin.saveSettings();
						})
				);
		}

		// --- Marker parameters ---

		containerEl.createEl("h3", { text: "Marker options" });

		new Setting(containerEl)
			.setName("Mode")
			.setDesc(
				"Processing mode. Fast is quickest, accurate uses LLM enhancement."
			)
			.addDropdown((dd) =>
				dd
					.addOption("fast", "Fast")
					.addOption("balanced", "Balanced")
					.addOption("accurate", "Accurate")
					.setValue(this.plugin.settings.mode)
					.onChange(async (value) => {
						this.plugin.settings.mode = value as MarkerMode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Page range")
			.setDesc(
				"Comma-separated page numbers or ranges (e.g. 0,5-10,20). Leave empty for all pages."
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g. 0,5-10")
					.setValue(this.plugin.settings.pageRange)
					.onChange(async (value) => {
						this.plugin.settings.pageRange = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Force OCR")
			.setDesc(
				"Force OCR on all text regions, even those with extractable digital text."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.forceOcr)
					.onChange(async (value) => {
						this.plugin.settings.forceOcr = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Use LLM")
			.setDesc(
				"Use an LLM to improve accuracy for tables, forms, inline math, and complex pages."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useLlm)
					.onChange(async (value) => {
						this.plugin.settings.useLlm = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Paginate output")
			.setDesc("Add page separator delimiters in output.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.paginateOutput)
					.onChange(async (value) => {
						this.plugin.settings.paginateOutput = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Strip existing OCR")
			.setDesc("Remove existing OCR text and re-OCR with Surya.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.stripExistingOcr)
					.onChange(async (value) => {
						this.plugin.settings.stripExistingOcr = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Format lines")
			.setDesc(
				"Add inline math and formatting to lines (auto-OCRs lines that need it)."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.formatLines)
					.onChange(async (value) => {
						this.plugin.settings.formatLines = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Disable image extraction")
			.setDesc("Skip image extraction from the PDF.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.disableImageExtraction)
					.onChange(async (value) => {
						this.plugin.settings.disableImageExtraction = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
