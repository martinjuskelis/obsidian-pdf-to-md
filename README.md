# PDF to Markdown

An Obsidian plugin that converts PDF files to Markdown using [Marker](https://github.com/VikParuchuri/marker), a high-accuracy PDF-to-markdown converter with OCR, table recognition, and optional LLM enhancement.

Works on desktop (Windows, macOS, Linux) and mobile (Android, iOS).

## Features

- Convert any PDF to Markdown from the command palette or file context menu
- Extracted images are saved alongside the PDF and referenced in the Markdown
- Configurable OCR, LLM enhancement, page range, and more
- Two API providers:
  - **Replicate** (default) — hosted Marker API, no setup required beyond an API key
  - **Modal** — self-hosted Marker on serverless GPU, with your choice of LLM (Claude, Gemini, GPT-4o, etc.)

## Usage

1. Open a PDF in Obsidian, or select one in the file explorer
2. Run **Convert PDF to Markdown** from the command palette (`Ctrl/Cmd+P`), or right-click the PDF and choose **Convert to Markdown**
3. The `.md` file is saved next to the original PDF with the same name

Any images extracted from the PDF are saved to a `<filename>-images/` folder beside it.

## Setup

### Replicate (quickest start)

1. Create an account at [replicate.com](https://replicate.com) and grab your API token
2. In Obsidian, go to **Settings > PDF to Markdown**
3. Set **Provider** to **Replicate**
4. Paste your API token

That's it. The plugin calls the hosted [datalab-to/marker](https://replicate.com/datalab-to/marker) model on Replicate.

### Modal (self-hosted, custom LLM)

Use this if you want to choose your own LLM for enhanced conversion (e.g. Claude Opus 4.6 via OpenRouter).

1. Install and authenticate Modal:
   ```bash
   pip install modal
   modal setup
   ```

2. Create a secret with your LLM provider key. For OpenRouter:
   ```bash
   modal secret create marker-llm-keys \
     OPENROUTER_API_KEY=sk-or-your-key \
     OPENROUTER_MODEL=anthropic/claude-opus-4-6
   ```
   Other providers work too — see the [marker-modal](https://github.com/martinjuskelis/marker-modal) repo for details.

3. Clone and deploy:
   ```bash
   git clone https://github.com/martinjuskelis/marker-modal.git
   cd marker-modal
   modal deploy marker_api.py
   ```
   This prints an endpoint URL.

4. In Obsidian, go to **Settings > PDF to Markdown**:
   - **Provider**: Modal
   - **Endpoint URL**: paste the URL from step 3

The first request after a cold start takes ~30 seconds (loading models onto GPU). Subsequent requests are much faster. The container scales to zero when idle — no charges while not in use.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Provider** | Replicate | Replicate (hosted) or Modal (self-hosted) |
| **Mode** | Balanced | Fast (no LLM), Balanced, or Accurate (forces LLM) |
| **Use LLM** | On | Use an LLM to improve tables, forms, math, and complex pages |
| **Force OCR** | Off | Force OCR even on pages with extractable digital text |
| **Paginate output** | Off | Add page separator delimiters in the Markdown |
| **Strip existing OCR** | Off | Remove existing OCR text and re-OCR with Surya |
| **Format lines** | Off | Add inline math and formatting to lines |
| **Disable image extraction** | Off | Skip extracting images from the PDF |
| **Page range** | All | Comma-separated pages or ranges (e.g. `0,5-10,20`) |
| **Debug logging** | Off | Log API responses to the developer console |

## Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/martinjuskelis/obsidian-pdf-to-md/releases/latest) and place them in your vault at `.obsidian/plugins/pdf-to-md/`.

Or install via [BRAT](https://github.com/TfTHacker/obsidian42-brat): add `martinjuskelis/obsidian-pdf-to-md` as a beta plugin.

## Building from source

```bash
git clone https://github.com/martinjuskelis/obsidian-pdf-to-md.git
cd obsidian-pdf-to-md
npm install
npm run build
```

The built `main.js` is ready to copy into your vault's plugin directory.

## License

MIT
