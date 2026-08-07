# OpenParse

Open-source, LlamaParse-like document parsing for Node.js. Bring your own LLM key.

Hybrid text + vision pipeline with cost-aware page routing. Free forever — you only pay your model provider.

```bash
npm install @openparse/core
# Optional — required only for agentic PDF page rendering:
npm install canvas
```

**Requires Node.js ≥ 20.**

---

## How it works

```
PDF / DOCX / PPTX / XLSX / Image / …
    │
    ├── Extract text / structure
    │
    ├── Complexity router (auto mode)
    │       ├── Plain prose          → fast            (no LLM)
    │       ├── Tables / multi-col   → cost_effective  (text → LLM)
    │       └── Scanned / image-only → agentic         (screenshot + VLM)
    │
    └── Merge → { markdown, text, pages, usage, errors }
```

| Mode | What it does | Needs API key | Needs `canvas` |
|------|----------------|---------------|----------------|
| `fast` | Heuristic / pre-rendered markdown from the text layer | No | No |
| `cost_effective` | Text layer → LLM for structure | Yes (or `client`) | No |
| `agentic` | Page image + text → vision LLM | Yes (or `client`) | Yes for **PDF** screenshots; **not** for direct image files |
| `auto` (default) | Picks a mode per page | Yes* | Only if a PDF page routes to agentic |

\*Unless every page would stay in `fast` — the API still requires a key up front when `mode` is not `'fast'`.

If PDF rendering fails (no `canvas`), agentic pages fall back to **raw extracted text** (no LLM call) — not a full `cost_effective` pass.

---

## Quick start

```ts
import { parse } from '@openparse/core'

const result = await parse('./report.pdf', {
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',
  mode: 'auto',
  onProgress({ pagesComplete, totalPages }) {
    process.stderr.write(`\r${pagesComplete}/${totalPages} pages`)
  },
})

console.log(result.markdown)
console.log(result.usage)
// { totalPages: 12, pagesByMode: { fast: 8, cost_effective: 3, agentic: 1 }, estimatedTokens: 4200 }
```

### Streaming

`parseStream()` yields each `PageResult` in page order as pages finish:

```ts
import { parseStream } from '@openparse/core'

for await (const page of parseStream('./report.pdf', {
  apiKey: process.env.OPENAI_API_KEY,
  mode: 'auto',
})) {
  console.log(`Page ${page.pageNumber}:`, page.markdown.slice(0, 80))
}
```

**`parseStream` vs `parse` today**

| | `parse` | `parseStream` |
|--|---------|---------------|
| Formats | Full set (see below) | PDF, images, DOCX |
| `maxTokenBudget` / `CostLimitError` | Yes | No |
| `resultType` / `items` | Yes | Ignored (yields pages only) |
| Unsupported local ext | `UnsupportedFormatError` | Treated as PDF |

Shared: `client`, `mode`, `pages` (PDF), `maxPages`, progress hooks, providers.

---

## Supported formats

### Fully supported (`parse`)

| Format | Extensions | Modes that produce useful output | Notes |
|--------|------------|----------------------------------|-------|
| PDF (digital) | `.pdf` | `fast`, `cost_effective`, `agentic`, `auto` | `pages` / `maxPages` apply |
| PDF (scanned) | `.pdf` | `agentic` / `auto` → agentic | Needs `canvas` to render pages |
| Images | `.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp` `.tiff` `.tif` `.heic` `.heif` | `agentic` (or `auto`) | No `canvas` needed; `fast` / `cost_effective` return empty text |
| Word | `.docx` | `fast`, `cost_effective`, `auto` | Via mammoth → markdown |
| PowerPoint | `.pptx` | `fast`, `cost_effective`, `auto` | One page per slide |
| Excel (OOXML) | `.xlsx` `.xlsm` | `fast`, `cost_effective`, `auto` | Sheets as GFM tables |
| Delimited | `.csv` `.tsv` | `fast`, `cost_effective`, `auto` | |
| Text / web | `.txt` `.md` `.markdown` `.html` `.htm` `.rtf` | `fast`, `cost_effective`, `auto` | RTF = control-word strip; HTML → markdown |

### Accepted but limited

| Extension | Behavior |
|-----------|----------|
| `.doc` `.ppt` | Accepted like DOCX/PPTX; legacy binary Office often fails — prefer `.docx` / `.pptx` |
| `.xls` `.ods` `.numbers` | Accepted as “spreadsheet”; extractor only understands SpreadsheetML (XLSX/XLSM). Prefer `.xlsx` / `.csv` |

Coverage targets common RAG inputs, not LlamaParse’s 130+ formats.

### Input shapes

| Input | Behavior |
|-------|----------|
| File path | Extension must be in the supported set or `UnsupportedFormatError` |
| `Buffer` | Magic-byte sniff: PNG/JPEG/GIF/WebP → image; ZIP (`PK`) → **DOCX**; else → **PDF**. PPTX/XLSX buffers are misclassified as DOCX — pass a path (or URL with the right extension) instead |
| HTTP(S) URL | Fetched; routed by URL extension (unknown ext → PDF). No `UnsupportedFormatError` |

---

## Provider support

Any OpenAI-compatible endpoint, plus an Anthropic Messages adapter.

### OpenAI (default)

```ts
await parse('./doc.pdf', {
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini', // default for non-agentic modes
  // model: 'gpt-4o',   // default when mode === 'agentic'
})
```

### Anthropic

```ts
await parse('./doc.pdf', {
  apiKey: process.env.ANTHROPIC_API_KEY,
  provider: 'anthropic',
  model: 'claude-3-5-haiku-20241022',
})
```

### Ollama (local)

```ts
await parse('./doc.pdf', {
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',
  model: 'llava:latest',
  provider: 'compatible',
  mode: 'cost_effective',
})
```

### Groq / Azure / other OpenAI-compatible

```ts
await parse('./doc.pdf', {
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
  model: 'llama-3.3-70b-versatile',
  provider: 'compatible',
})
```

Environment variables: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENPARSE_MODEL` (overrides default model).

---

## API reference

### Exports

```ts
import {
  parse,
  parseStream,
  OpenAIClient,
  AnthropicClient,
  createLLMClient,
  classifyPage,
  OpenParseError,
  InvalidDocumentError,
  UnsupportedFormatError,
  CostLimitError,
} from '@openparse/core'
```

### `parse(input, options?) → Promise<ParseResult>`

`input`: `string` (path or URL) | `Buffer` | `URL`

### `parseStream(input, options?) → AsyncGenerator<PageResult>`

Same option bag as `parse`, with the limitations in the streaming table above.

#### `ParseOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | env | `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (by provider) |
| `model` | `string` | `gpt-4o-mini`, or `gpt-4o` if `mode === 'agentic'` | Overridable via `OPENPARSE_MODEL` |
| `baseUrl` | `string` | OpenAI or Anthropic default | Custom endpoint |
| `provider` | `'openai' \| 'anthropic' \| 'compatible'` | `'openai'` | Wire format |
| `client` | `LLMClient` | — | Injected client; skips `apiKey` / `baseUrl` / `provider` for construction |
| `mode` | `'fast' \| 'cost_effective' \| 'agentic' \| 'auto'` | `'auto'` | |
| `resultType` | `'markdown' \| 'text' \| 'json'` | `'markdown'` | Controls `items` population; `markdown` + `text` are always filled on the result |
| `instructions` | `string` | — | Extra LLM instructions |
| `pages` | `string` | all | PDF only, e.g. `'1-5,8'` (1-indexed). Out-of-range → `InvalidDocumentError` |
| `concurrency` | `number` | `3` | Max concurrent page work |
| `temperature` | `number` | `0` | |
| `maxRetries` | `number` | `3` | Per-page retries |
| `dpi` | `number` | `150` | PDF render DPI for agentic. Use `200`–`300` for dense financials / small fonts |
| `maxPages` | `number` | unlimited | Caps enumerated PDF page list before extraction |
| `maxTokenBudget` | `number` | unlimited | `parse` only — throws `CostLimitError` when cumulative tokens exceed budget |
| `debug` | `boolean` | `false` | |
| `onPageComplete` | `function` | — | |
| `onProgress` | `function` | — | `{ pagesComplete, totalPages, percent }` |

#### `ParseResult`

```ts
{
  markdown: string
  text: string
  pages: PageResult[]   // { pageNumber, markdown, text, mode, modeUsed, hasScreenshot, tokensUsed?, error? }
  items?: {             // only if resultType === 'json' AND ≥1 page used an LLM
    headings: Array<{ level, text, pageNumber }>
    tables: Array<{ markdown, pageNumber }>
    paragraphs: Array<{ text, pageNumber }>
  }
  usage: {
    totalPages: number
    pagesByMode: Record<string, number>
    estimatedTokens: number
    durationMs: number
  }
  metadata: {
    filename: string
    pageCount: number
    durationMs: number
    model: string | null  // null when no LLM was used
    version: string
  }
  errors: Array<{ pageNumber, error }>
}
```

#### Errors

| Class | When |
|-------|------|
| `UnsupportedFormatError` | Local path with unknown extension |
| `InvalidDocumentError` | Corrupt/unreadable PDF, or `pages` range outside the document |
| `CostLimitError` | `maxTokenBudget` exceeded — see `error.partialResult` |
| `OpenParseError` | Base class for the above |

Missing API key (when required) throws a plain `Error`.

---

## CLI

```bash
npx @openparse/core ./report.pdf
npx @openparse/core ./report.pdf --mode agentic --dpi 250
npx @openparse/core ./report.pdf --pages "1-5,8"
npx @openparse/core ./report.pdf --json -o out.json

# Ollama
npx @openparse/core ./report.pdf \
  --base-url http://localhost:11434/v1 \
  --api-key ollama \
  --model llava:latest \
  --provider compatible
```

Also available as binaries `openparse` / `op` after install.

```
Arguments:
  <file>                   Path or HTTP(S) URL

Options:
  -m, --mode <mode>        fast | cost_effective | agentic | auto (default: auto)
  --model <model>          LLM model name
  --api-key <key>          LLM API key
  --base-url <url>         Custom API base URL
  --provider <p>           openai | anthropic | compatible (default: openai)
  --result-type <type>     markdown | text | json (default: markdown)
  --pages <range>          Page range, e.g. "1-5,8" (PDF only)
  -c, --concurrency <n>    Max concurrent requests (default: 3)
  --dpi <n>                Render DPI for agentic mode (default: 150)
  --instructions <text>    Custom LLM instructions
  -o, --out <path>         Output file (default: stdout)
  --json                   Shorthand for --result-type json
  --debug                  Verbose logging to stderr
```

Not exposed in the CLI (API only): `temperature`, `maxRetries`, `maxPages`, `maxTokenBudget`, `client`.

---

## Agentic mode + `canvas`

Agentic **PDF** rendering needs the optional `canvas` package:

```bash
npm install canvas
```

See [node-canvas installation](https://github.com/Automattic/node-canvas#installation) for native deps.

- Direct image inputs (PNG/JPEG/…) work in agentic mode **without** `canvas`.
- Without `canvas`, PDF agentic pages degrade to raw text (no LLM).

### Tuning DPI

Default `dpi` is **150**. For dense filings or small-font tables:

```ts
await parse('./10-K.pdf', { mode: 'agentic', dpi: 250 })
```

Higher DPI → larger images, more vision tokens, slower renders.

### Docker / serverless

```dockerfile
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev librsvg2-dev \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
```

Or skip `canvas`: use `fast` / `cost_effective`, or pass page images directly.

---

## Structured output (JSON mode)

```ts
const result = await parse('./doc.pdf', {
  resultType: 'json',
  mode: 'cost_effective', // force LLM — see note
})

console.log(result.items?.headings)
console.log(result.items?.tables)
```

`items` is set only when `resultType === 'json'` **and** at least one page ran `cost_effective` or `agentic`. Fast-only runs leave `items` as `undefined`. Prefer an explicit LLM mode when you need structured extraction.

---

## Custom LLM client

```ts
import { parse, OpenAIClient, AnthropicClient, createLLMClient } from '@openparse/core'

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY!,
  baseUrl: 'https://api.groq.com/openai/v1',
})

await parse('./doc.pdf', {
  client,
  model: 'llama-3.3-70b-versatile',
  mode: 'cost_effective',
})

// Factory
const anthropic = createLLMClient({
  provider: 'anthropic',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  baseUrl: 'https://api.anthropic.com',
})
```

Or implement `LLMClient` (`chat(request) → { content, tokensUsed? }`) yourself.

Constructors also accept positional `(apiKey, baseUrl?)`.

---

## Cost guide

| Mode | Typical cost | When used |
|------|-------------|-----------|
| `fast` | $0 | Dense prose / pre-rendered office formats |
| `cost_effective` | ~$0.001–0.005/page | Most digital PDFs (`gpt-4o-mini`) |
| `agentic` | ~$0.01–0.05/page | Scans / complex layouts (`gpt-4o`) |
| Ollama | $0 | Local models |

`mode: 'auto'` keeps most pages on `fast` / `cost_effective`.

---

## Comparison with LlamaParse

| Feature | OpenParse | LlamaParse |
|---------|-----------|------------|
| Pricing | Free (pay your provider) | Per-page hosted |
| Privacy | Your keys / your infra | LlamaCloud |
| Node.js native | Yes | SDK → hosted API |
| Offline | Yes (Ollama) | Partial |
| Format breadth | Common office + web | 130+ |
| Dense financial agentic | Partial (tune `dpi`, vision model) | Strongest |

---

## Development

```bash
git clone https://github.com/nandushaji/openparse.git
cd openparse
npm install
npm run build
npm test
npm run eval   # add PDFs under tests/fixtures/ first
```

---

## Contributing

Open an issue before large PRs.

Roadmap priorities:
- [ ] Align `parseStream` format parity with `parse`
- [ ] Real `.xls` / `.ods` support (or stop accepting those extensions)
- [ ] Broader formats (EPUB, …)
- [ ] Non-LLM heuristic `items` for fast mode
- [ ] OpenAI Structured Outputs for JSON mode
- [ ] CLI: `maxPages` / `maxTokenBudget`

---

## License

MIT
