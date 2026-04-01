import { Notice, Plugin, TFile, TFolder, requestUrl } from "obsidian";
import {
	DEFAULT_SETTINGS,
	PdfToMdSettingTab,
	type PdfToMdSettings,
} from "./settings";
import { convertWithReplicate } from "./replicate";
import { convertWithModal } from "./modal";

export interface ConversionResult {
	markdown: string;
	images: Record<string, string>; // filename → base64 or URL
	elapsedSeconds?: number;
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

		this.addCommand({
			id: "convert-folder-pdfs",
			name: "Convert all PDFs in current folder",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				const folder = file?.parent;
				if (!folder) return false;
				if (!checking) this.convertFolder(folder);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, abstractFile) => {
				if (abstractFile instanceof TFile && abstractFile.extension === "pdf") {
					menu.addItem((item) => {
						item.setTitle("Convert to Markdown")
							.setIcon("file-text")
							.onClick(() => this.convertPdf(abstractFile));
					});
				}
				if (abstractFile instanceof TFolder) {
					menu.addItem((item) => {
						item.setTitle("Convert all PDFs to Markdown")
							.setIcon("files")
							.onClick(() => this.convertFolder(abstractFile));
					});
				}
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

	private activeJobs = 0;

	private async convertOne(file: TFile): Promise<boolean> {
		const signal = { cancelled: false };
		const pdfBuffer = await this.app.vault.readBinary(file);

		let result: ConversionResult;
		if (this.settings.provider === "replicate") {
			result = await convertWithReplicate(
				pdfBuffer,
				this.settings,
				() => {},
				signal
			);
		} else {
			result = await convertWithModal(
				pdfBuffer,
				this.settings,
				() => {}
			);
		}

		await this.saveResult(file, result);
		return true;
	}

	private async convertPdf(file: TFile) {
		if (this.activeJobs > 0) {
			new Notice("A conversion is already in progress.");
			return;
		}
		this.activeJobs = 1;
		const notice = new Notice(`Converting ${file.name}...`, 0);

		try {
			await this.convertOne(file);
			notice.hide();
			new Notice(`Converted ${file.name} to Markdown.`, 5000);
		} catch (err) {
			notice.hide();
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Failed: ${msg}`, 8000);
			console.error("pdf-to-md: conversion error", err);
		} finally {
			this.activeJobs = 0;
		}
	}

	private async convertFolder(folder: TFolder) {
		if (this.activeJobs > 0) {
			new Notice("A conversion is already in progress.");
			return;
		}

		// Collect PDFs in this folder (non-recursive)
		let pdfs = folder.children.filter(
			(f): f is TFile => f instanceof TFile && f.extension === "pdf"
		);

		if (this.settings.skipExisting) {
			pdfs = pdfs.filter((f) => {
				const mdPath = joinPath(
					f.parent?.path ?? "",
					`${f.basename}.md`
				);
				return !this.app.vault.getAbstractFileByPath(mdPath);
			});
		}

		if (pdfs.length === 0) {
			new Notice("No PDFs to convert in this folder.");
			return;
		}

		const total = pdfs.length;
		let completed = 0;
		let failed = 0;
		const concurrency = this.settings.concurrency;
		const notice = new Notice(
			`Converting 0/${total} PDFs (${concurrency} parallel)...`,
			0
		);

		this.activeJobs = total;

		const update = () => {
			notice.setMessage(
				`Converting PDFs: ${completed}/${total} done` +
					(failed > 0 ? `, ${failed} failed` : "") +
					` (${concurrency} parallel)`
			);
		};

		// Process with concurrency limit
		const queue = [...pdfs];
		const workers = Array.from(
			{ length: Math.min(concurrency, queue.length) },
			async () => {
				while (queue.length > 0) {
					const file = queue.shift()!;
					try {
						await this.convertOne(file);
						completed++;
					} catch (err) {
						failed++;
						console.error(
							`pdf-to-md: failed to convert ${file.path}`,
							err
						);
					}
					update();
				}
			}
		);

		await Promise.all(workers);
		this.activeJobs = 0;
		notice.hide();
		new Notice(
			`Batch complete: ${completed}/${total} converted` +
				(failed > 0 ? `, ${failed} failed` : ""),
			8000
		);
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
				const imgValue = result.images[imgName];
				let imgBytes: ArrayBuffer;

				if (imgValue.startsWith("http://") || imgValue.startsWith("https://")) {
					// Download image from URL
					const resp = await requestUrl({ url: imgValue, method: "GET" });
					imgBytes = resp.arrayBuffer;
				} else {
					// Decode base64
					imgBytes = base64ToArrayBuffer(imgValue);
				}

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
