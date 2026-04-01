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

	// ------- Conversion queue -------

	private queue: TFile[] = [];
	private running = 0;
	private batchTotal = 0;
	private batchDone = 0;
	private batchFailed = 0;
	private batchNotice: Notice | null = null;

	private async convertOne(file: TFile): Promise<void> {
		const signal = { cancelled: false };
		const pdfBuffer = await this.app.vault.readBinary(file);
		const maxRetries = 3;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
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
				return;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				const isTransient =
					msg.includes("429") ||
					msg.includes("500") ||
					msg.includes("502") ||
					msg.includes("503") ||
					msg.includes("504") ||
					msg.includes("timeout") ||
					msg.includes("ETIMEDOUT") ||
					msg.includes("ECONNRESET") ||
					msg.includes("network");

				if (isTransient && attempt < maxRetries) {
					const delay = attempt * 5000; // 5s, 10s
					console.log(
						`pdf-to-md: retrying ${file.name} (attempt ${attempt + 1}/${maxRetries}) in ${delay / 1000}s`
					);
					await sleep(delay);
					continue;
				}
				throw err;
			}
		}
	}

	private enqueue(files: TFile[]) {
		for (const f of files) {
			if (!this.queue.includes(f)) {
				this.queue.push(f);
				this.batchTotal++;
			}
		}
		this.updateNotice();
		this.drain();
	}

	private drain() {
		const concurrency = this.settings.concurrency;
		while (this.running < concurrency && this.queue.length > 0) {
			const file = this.queue.shift()!;
			this.running++;
			this.processFile(file);
		}
	}

	private async processFile(file: TFile) {
		try {
			await this.convertOne(file);
			this.batchDone++;
			new Notice(`Converted ${file.name}`, 3000);
		} catch (err) {
			this.batchFailed++;
			const msg = err instanceof Error ? err.message : String(err);
			new Notice(`Failed ${file.name}: ${msg}`, 6000);
			console.error(`pdf-to-md: failed ${file.path}`, err);
		} finally {
			this.running--;
			this.updateNotice();
			if (this.queue.length > 0) {
				this.drain();
			} else if (this.running === 0) {
				this.finishBatch();
			}
		}
	}

	private updateNotice() {
		if (this.batchTotal <= 1) return; // single file — no progress bar needed
		if (!this.batchNotice) {
			this.batchNotice = new Notice("", 0);
		}
		const queued = this.queue.length;
		this.batchNotice.setMessage(
			`PDF conversion: ${this.batchDone}/${this.batchTotal} done, ` +
				`${this.running} active` +
				(queued > 0 ? `, ${queued} queued` : "") +
				(this.batchFailed > 0 ? `, ${this.batchFailed} failed` : "")
		);
	}

	private finishBatch() {
		if (this.batchNotice) {
			this.batchNotice.hide();
			this.batchNotice = null;
		}
		if (this.batchTotal > 1) {
			new Notice(
				`Batch complete: ${this.batchDone}/${this.batchTotal} converted` +
					(this.batchFailed > 0
						? `, ${this.batchFailed} failed`
						: ""),
				8000
			);
		}
		this.batchTotal = 0;
		this.batchDone = 0;
		this.batchFailed = 0;
	}

	private convertPdf(file: TFile) {
		if (this.batchTotal === 0) {
			// Starting fresh
			this.batchTotal = 0;
			this.batchDone = 0;
			this.batchFailed = 0;
		}
		this.enqueue([file]);
	}

	private convertFolder(folder: TFolder) {
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

		this.enqueue(pdfs);
	}

	// ------- File saving -------

	private async saveResult(
		pdfFile: TFile,
		result: ConversionResult
	) {
		const parentPath = pdfFile.parent?.path ?? "";
		const baseName = pdfFile.basename; // filename without extension

		// Save images (if any, and if not disabled)
		let markdown = result.markdown;
		const imageNames = this.settings.disableImageExtraction
			? []
			: Object.keys(result.images);

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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
