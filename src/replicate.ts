import { requestUrl } from "obsidian";
import type { PdfToMdSettings } from "./settings";
import type { ConversionResult } from "./main";

const MODEL_URL =
	"https://api.replicate.com/v1/models/datalab-to/marker/predictions";
const POLL_INITIAL_MS = 2000;
const POLL_MAX_MS = 10000;
const POLL_BACKOFF = 1.5;

interface ReplicatePrediction {
	id: string;
	status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
	output: {
		format: string;
		output: string;
		images: Record<string, string>;
		success: boolean;
	} | null;
	error: string | null;
	urls: { get: string; cancel: string };
}

function buildInput(
	fileDataUri: string,
	settings: PdfToMdSettings
): Record<string, unknown> {
	const input: Record<string, unknown> = {
		file: fileDataUri,
		output_format: "markdown",
		mode: settings.mode,
	};
	if (settings.forceOcr) input.force_ocr = true;
	if (settings.useLlm) input.use_llm = true;
	if (settings.paginateOutput) input.paginate_output = true;
	if (settings.stripExistingOcr) input.strip_existing_ocr = true;
	if (settings.formatLines) input.format_lines = true;
	if (settings.disableImageExtraction) input.disable_image_extraction = true;
	if (settings.pageRange) input.page_range = settings.pageRange;
	return input;
}

function authHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		"Content-Type": "application/json",
	};
}

export async function convertWithReplicate(
	pdfBuffer: ArrayBuffer,
	settings: PdfToMdSettings,
	onProgress: (msg: string) => void,
	signal: { cancelled: boolean }
): Promise<ConversionResult> {
	if (!settings.replicateApiToken) {
		throw new Error("Replicate API token is not set. Check plugin settings.");
	}

	// Encode PDF as data URI
	onProgress("Encoding PDF...");
	const base64 = arrayBufferToBase64(pdfBuffer);
	const dataUri = `data:application/pdf;base64,${base64}`;

	// Create prediction
	onProgress("Submitting to Replicate...");
	const createResp = await requestUrl({
		url: MODEL_URL,
		method: "POST",
		headers: authHeaders(settings.replicateApiToken),
		body: JSON.stringify({ input: buildInput(dataUri, settings) }),
		throw: false,
	});

	if (createResp.status !== 201) {
		const detail =
			createResp.json?.detail || createResp.text || `HTTP ${createResp.status}`;
		throw new Error(`Replicate: failed to create prediction — ${detail}`);
	}

	const prediction: ReplicatePrediction = createResp.json;

	// Poll for completion
	let pollUrl = prediction.urls.get;
	let delay = POLL_INITIAL_MS;

	while (true) {
		if (signal.cancelled) {
			// Best-effort cancel
			await requestUrl({
				url: prediction.urls.cancel,
				method: "POST",
				headers: authHeaders(settings.replicateApiToken),
				throw: false,
			});
			throw new Error("Conversion cancelled.");
		}

		await sleep(delay);
		delay = Math.min(delay * POLL_BACKOFF, POLL_MAX_MS);

		onProgress("Waiting for Marker to finish...");
		const pollResp = await requestUrl({
			url: pollUrl,
			method: "GET",
			headers: authHeaders(settings.replicateApiToken),
			throw: false,
		});

		if (pollResp.status !== 200) {
			throw new Error(
				`Replicate: polling failed — HTTP ${pollResp.status}`
			);
		}

		const current: ReplicatePrediction = pollResp.json;

		if (current.status === "failed" || current.status === "canceled") {
			const logs = (current as any).logs || "";
			const lastLog = logs.split("\n").filter(Boolean).slice(-3).join(" | ");
			throw new Error(
				`Replicate: prediction ${current.status} — ${current.error || "unknown error"}${lastLog ? ` — Logs: ${lastLog}` : ""}`
			);
		}

		if (current.status === "succeeded") {
			const out = current.output;
			console.log("pdf-to-md: Replicate output:", JSON.stringify(out).slice(0, 2000));

			if (!out) {
				throw new Error("Replicate: prediction succeeded but output is null.");
			}

			if ((out as any).success === false) {
				throw new Error(
					`Marker conversion failed. Keys: ${Object.keys(out).join(", ")}. ` +
					`Raw: ${JSON.stringify(out).slice(0, 500)}`
				);
			}

			// Handle various possible output shapes
			const markdown =
				(out as any).output ??
				(out as any).markdown ??
				(typeof out === "string" ? out : "");

			// Images can be: array of URLs, or object { filename: base64/url }
			let images: Record<string, string> = {};
			const rawImages = (out as any).images;
			if (Array.isArray(rawImages)) {
				for (const url of rawImages) {
					const filename = url.split("/").pop() || url;
					images[filename] = url;
				}
			} else if (rawImages && typeof rawImages === "object") {
				images = rawImages;
			}

			if (!markdown) {
				throw new Error(
					`Replicate: no markdown in output. Keys: ${Object.keys(out).join(", ")}`
				);
			}

			return { markdown, images };
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}
