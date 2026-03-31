import { Notice, Plugin, TFile, TFolder } from "obsidian";
import {
	DEFAULT_SETTINGS,
	PdfToMdSettingTab,
	type PdfToMdSettings,
} from "./settings";
import { convertWithReplicate } from "./replicate";
import { convertWithModal } from "./modal";

export interface ConversionResult {
	markdown: string;
	images: Record<string, string>; // filename → base64
}

export default class PdfToMdPlugin extends Plugin {
	settings: PdfToMdSettings = DEFAULT_SETTINGS;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: "convert-pdf-to-md",
			name: "Convert PDF to Markdown",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "pdf") return false;
				if (!checking) this.convertPdf(file);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, abstractFile) => {
				if (!(abstractFile instanceof TFile)) return;
				if (abstractFile.extension !== "pdf") return;
				menu.addItem((item) => {
					item.setTitle("Convert to Markdown")
						.setIcon("file-text")
						.onClick(() => this.convertPdf(abstractFile));
				});
			})
		);

		this.addSettingTab(new PdfToMdSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ------- Conversion -------

	private converting = false;

	private async convertPdf(file: TFile) {
		if (this.converting) {
			new Notice("A conversion is already in progress.");
			return;
		}
		this.converting = true;

		const progressNotice = new Notice("Starting PDF conversion...", 0);
		const signal = { cancelled: false };

		const onProgress = (msg: string) => {
			progressNotice.setMessage(msg);
		};

		try {
			// Read PDF binary
			onProgress("Reading PDF...");
			const pdfBuffer = await this.app.vault.readBinary(file);

			// Call provider
			let result: ConversionResult;
			if (this.settings.provider === "replicate") {
				result = await convertWithReplicate(
					pdfBuffer,
					this.settings,
					onProgress,
					signal
				);
			} else {
				result = await convertWithModal(
					pdfBuffer,
					this.settings,
					onProgress
				);
			}

			// Save result
			onProgress("Saving files...");
			await this.saveResult(file, result);

			progressNotice.hide();
			new Notice(
				`Converted ${file.name} to Markdown.`,
				5000
			);
		} catch (err) {
			progressNotice.hide();
			const msg =
				err instanceof Error ? err.message : String(err);
			new Notice(`PDF conversion failed: ${msg}`, 8000);
			console.error("pdf-to-md: conversion error", err);
		} finally {
			this.converting = false;
		}
	}

	// ------- File saving -------

	private async saveResult(
		pdfFile: TFile,
		result: ConversionResult
	) {
		const parentPath = pdfFile.parent?.path ?? "";
		const baseName = pdfFile.basename; // filename without extension

		// Save images (if any)
		let markdown = result.markdown;
		const imageNames = Object.keys(result.images);

		if (imageNames.length > 0) {
			const imageDir = joinPath(parentPath, `${baseName}-images`);
			await this.ensureFolder(imageDir);

			for (const imgName of imageNames) {
				const imgBase64 = result.images[imgName];
				const imgBytes = base64ToArrayBuffer(imgBase64);
				const imgPath = joinPath(imageDir, imgName);

				const existing =
					this.app.vault.getAbstractFileByPath(imgPath);
				if (existing instanceof TFile) {
					await this.app.vault.modifyBinary(existing, imgBytes);
				} else {
					await this.app.vault.createBinary(imgPath, imgBytes);
				}
			}

			// Rewrite image references to relative paths
			const imagePrefix = `${baseName}-images`;
			for (const imgName of imageNames) {
				// Handle both ![alt](imgName) and ![alt](./imgName) patterns
				markdown = markdown
					.replace(
						new RegExp(
							`(!\\[[^\\]]*\\]\\()(\\.\\/)?(${escapeRegex(imgName)}\\))`,
							"g"
						),
						`$1${imagePrefix}/${imgName})`
					);
			}
		}

		// Save markdown
		const mdPath = joinPath(parentPath, `${baseName}.md`);
		const existing = this.app.vault.getAbstractFileByPath(mdPath);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, markdown);
		} else {
			await this.app.vault.create(mdPath, markdown);
		}
	}

	private async ensureFolder(path: string) {
		if (this.app.vault.getAbstractFileByPath(path) instanceof TFolder) {
			return;
		}
		await this.app.vault.createFolder(path);
	}
}

// ------- Utilities -------

function joinPath(dir: string, name: string): string {
	return dir ? `${dir}/${name}` : name;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const raw = atob(base64);
	const bytes = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) {
		bytes[i] = raw.charCodeAt(i);
	}
	return bytes.buffer;
}
