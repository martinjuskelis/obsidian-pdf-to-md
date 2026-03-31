import { requestUrl } from "obsidian";
import type { PdfToMdSettings } from "./settings";
import type { ConversionResult } from "./main";

/**
 * Sends a PDF to a user-hosted Marker deployment on Modal.
 *
 * Expected endpoint contract:
 *   POST <endpoint>
 *   Content-Type: application/json
 *   Authorization: Bearer <key>   (if key is set)
 *
 *   Body: { "file": "data:application/pdf;base64,...", "output_format": "markdown", ... }
 *
 *   Response (synchronous):
 *   { "output": "<markdown>", "images": { "img.png": "<base64>", ... }, "success": true }
 */
export async function convertWithModal(
	pdfBuffer: ArrayBuffer,
	settings: PdfToMdSettings,
	onProgress: (msg: string) => void
): Promise<ConversionResult> {
	if (!settings.modalEndpoint) {
		throw new Error("Modal endpoint URL is not set. Check plugin settings.");
	}

	onProgress("Encoding PDF...");
	const base64 = arrayBufferToBase64(pdfBuffer);
	const dataUri = `data:application/pdf;base64,${base64}`;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (settings.modalApiKey) {
		headers["Authorization"] = `Bearer ${settings.modalApiKey}`;
	}

	const body: Record<string, unknown> = {
		file: dataUri,
		output_format: "markdown",
		mode: settings.mode,
	};
	if (settings.forceOcr) body.force_ocr = true;
	if (settings.useLlm) body.use_llm = true;
	if (settings.paginateOutput) body.paginate_output = true;
	if (settings.stripExistingOcr) body.strip_existing_ocr = true;
	if (settings.formatLines) body.format_lines = true;
	if (settings.disableImageExtraction) body.disable_image_extraction = true;
	if (settings.pageRange) body.page_range = settings.pageRange;

	onProgress("Sending to Modal...");
	const resp = await requestUrl({
		url: settings.modalEndpoint,
		method: "POST",
		headers,
		body: JSON.stringify(body),
		throw: false,
	});

	if (resp.status < 200 || resp.status >= 300) {
		const detail = resp.text || `HTTP ${resp.status}`;
		throw new Error(`Modal: request failed — ${detail}`);
	}

	const data = resp.json;
	if (!data || data.success === false) {
		throw new Error(
			"Modal: Marker returned success=false. The PDF may be unsupported."
		);
	}

	return {
		markdown: data.output || data.markdown || "",
		images: data.images || {},
	};
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
