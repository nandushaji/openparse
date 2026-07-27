# OpenParse

Open-source, LlamaParse-like document parsing for Node.js. Bring your own LLM key.

Hybrid text + vision pipeline with cost-aware page routing. Free forever — you only pay your model provider.

```bash
npm install @openparse/core
```

---

## How it works

OpenParse mirrors the mental model of LlamaParse's tiers but runs entirely on your own API key:

```
PDF / Image
    │
    ├── Extract text layer (pdfjs-dist)
    │
    ├── Complexity router
    │       ├── Plain prose          → fast   (no LLM call)
    │       ├── Tables / multi-col   → cost_effective (text → LLM)
    │       └── Scanned / image-only → agentic (screenshot + VLM)
    │
    └── Merge pages → { markdown, text, pages, usage }
```

- **fast** — formats the PDF text layer with simple heuristics; zero LLM cost.
- **cost_effective** — sends the text layer to a language model for structure reconstruction. Best for most digital PDFs.
- **agentic** — renders each page to a PNG and sends image + text layer to a vision model. Best for scans, tables, complex layouts.
- **auto** (default) — picks the mode per-page automatically.

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

---

## Provider support

OpenParse talks to any OpenAI-compatible endpoint and also ships an Anthropic adapter.

### OpenAI (default)

```ts
await parse('./doc.pdf', {
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',      // cost_effective
  // model: 'gpt-4o',        // agentic (vision)
})
```

### Anthropic (Claude)

```ts
await parse('./doc.pdf', {
  apiKey: process.env.ANTHROPIC_API_KEY,
  provider: 'anthropic',
  model: 'claude-3-5-haiku-20241022',   // cost_effective
  // model: 'claude-3-5-sonnet-20241022', // agentic (vision)
})
```

### Ollama (local, free)

```bash
ollama pull llava   # or llama3.2-vision, moondream, etc.
```

```ts
await parse('./doc.pdf', {
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',     // ignored by Ollama
  model: 'llava:latest',
  provider: 'compatible',
  mode: 'cost_effective',
})
```

### Groq

```ts
await parse('./doc.pdf', {
  baseUrl: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
  model: 'llama-3.1-70b-versatile',
  provider: 'compatible',
})
```

### Azure OpenAI

```ts
await parse('./doc.pdf', {
  baseUrl: 'https://<resource>.openai.azure.com/openai/deployments/<deployment>',
  apiKey: process.env.AZURE_OPENAI_KEY,
  provider: 'compatible',
})
```

---

## API reference

### `parse(input, options) → Promise<ParseResult>`

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `string \| Buffer \| URL` | File path, raw buffer, or HTTP(S) URL |
| `options` | `ParseOptions` | See below |

#### ParseOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | env | `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` |
| `model` | `string` | `gpt-4o-mini` / `gpt-4o` | LLM model name |
| `baseUrl` | `string` | OpenAI | API base URL |
| `provider` | `'openai' \| 'anthropic' \| 'compatible'` | `'openai'` | API format |
| `mode` | `'fast' \| 'cost_effective' \| 'agentic' \| 'auto'` | `'auto'` | Parsing tier |
| `resultType` | `'markdown' \| 'text' \| 'json'` | `'markdown'` | Output format |
| `instructions` | `string` | — | Custom instructions sent to the LLM |
| `pages` | `string` | all | Page range, e.g. `'1-5,8'` (PDF only) |
| `concurrency` | `number` | `3` | Max concurrent LLM requests |
| `temperature` | `number` | `0` | LLM temperature |
| `maxRetries` | `number` | `3` | Retry attempts on transient errors |
| `dpi` | `number` | `150` | Render DPI for agentic mode |
| `debug` | `boolean` | `false` | Debug logging to stderr |
| `onPageComplete` | `function` | — | Called after each page |
| `onProgress` | `function` | — | Called after each page with progress % |

#### ParseResult

```ts
{
  markdown: string          // Full document markdown
  text: string              // Full plain text
  pages: PageResult[]       // Per-page results
  items?: {                 // Populated when resultType='json'
    headings: [...],
    tables: [...],
    paragraphs: [...]
  }
  usage: {
    totalPages: number
    pagesByMode: { fast: 3, cost_effective: 5, ... }
    estimatedTokens: number
    durationMs: number
  }
  metadata: { filename, pageCount, model, version, durationMs }
  errors: [{ pageNumber, error }]  // Per-page failures (others succeed)
}
```

---

## CLI

```bash
# Basic
npx @openparse/core ./report.pdf

# Force a specific mode
npx @openparse/core ./report.pdf --mode agentic

# Parse specific pages
npx @openparse/core ./report.pdf --pages "1-5,8"

# Use Ollama locally
npx @openparse/core ./report.pdf \
  --base-url http://localhost:11434/v1 \
  --api-key ollama \
  --model llava:latest \
  --provider compatible

# Output JSON and save to file
npx @openparse/core ./report.pdf --json -o output.json

# Use Anthropic
ANTHROPIC_API_KEY=sk-ant-... npx @openparse/core ./report.pdf \
  --provider anthropic \
  --model claude-3-5-haiku-20241022
```

### CLI options

```
Arguments:
  <file>                   Path to PDF/image or HTTP(S) URL

Options:
  -m, --mode <mode>        fast | cost_effective | agentic | auto (default: auto)
  --model <model>          LLM model name
  --api-key <key>          LLM API key
  --base-url <url>         Custom API base URL
  --provider <p>           openai | anthropic | compatible (default: openai)
  --result-type <type>     markdown | text | json (default: markdown)
  --pages <range>          Page range, e.g. "1-5,8"
  -c, --concurrency <n>    Max concurrent requests (default: 3)
  --dpi <n>                Render DPI for agentic mode (default: 150)
  --instructions <text>    Custom LLM parsing instructions
  -o, --out <path>         Output file (default: stdout)
  --json                   Shorthand for --result-type json
  --debug                  Enable debug logging
```

Environment variables: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENPARSE_MODEL`.

---

## Agentic mode + PDF rendering

Agentic mode renders PDF pages to PNG and sends them to a vision model. This requires the `canvas` native module:

```bash
npm install canvas
```

`canvas` needs a native build toolchain. See [node-canvas installation](https://github.com/Automattic/node-canvas#installation) for platform-specific instructions.

If `canvas` is not installed, agentic mode falls back to text-only (same as `cost_effective`). You can also pass image files (PNG/JPEG) directly, which works without `canvas`:

```ts
await parse('./scanned-page.png', {
  mode: 'agentic',
  // ... api options
})
```

---

## Structured output (JSON mode)

```ts
const result = await parse('./doc.pdf', {
  resultType: 'json',
  // ...
})

console.log(result.items?.headings)
// [{ level: 1, text: 'Title', pageNumber: 1 }, ...]

console.log(result.items?.tables)
// [{ markdown: '| Col | Col |\n|-----|-----|', pageNumber: 3 }, ...]
```

---

## Custom LLM client

Implement the `LLMClient` interface to use any backend:

```ts
import type { LLMClient, LLMRequest, LLMResponse } from '@openparse/core'

class MyClient implements LLMClient {
  async chat(request: LLMRequest): Promise<LLMResponse> {
    // call your API
    return { content: '...', tokensUsed: 42 }
  }
}
```

---

## Supported formats

| Format | Mode support |
|--------|-------------|
| PDF (digital) | fast, cost_effective, agentic |
| PDF (scanned) | agentic (requires canvas) |
| PNG / JPEG / WebP | agentic |
| DOCX / PPTX | planned (v1.1) |

---

## Cost guide

| Mode | Typical cost | When used |
|------|-------------|-----------|
| `fast` | $0 | Dense prose, no LLM |
| `cost_effective` | ~$0.001–0.005/page | Most digital PDFs with `gpt-4o-mini` |
| `agentic` | ~$0.01–0.05/page | Scans, tables, complex layouts with `gpt-4o` |
| Ollama (local) | $0 | All modes, self-hosted |

With `mode: 'auto'`, most documents spend the majority of pages in `fast` or `cost_effective`, cutting costs significantly vs always-on vision.

---

## Comparison with LlamaParse

| Feature | OpenParse | LlamaParse |
|---------|-----------|------------|
| Pricing | Free (pay your provider) | $0.003–$0.04+/page |
| Data privacy | Your infrastructure | LlamaCloud (enterprise VPC available) |
| Quality on common docs | Competitive | Strong |
| Agentic_plus (dense financials) | Partial | Best-in-class |
| Node.js native | Yes | Via SDK (hosted service) |
| Offline / local | Yes (Ollama) | Partial (LiteParse server) |
| 130+ formats | Planned | Yes |

OpenParse is designed for teams that already pay for OpenAI/Anthropic/Ollama and want layout-aware parsing without LlamaCloud credits. For the hardest financial/legal agentic workflows, LlamaParse's `agentic_plus` tier currently has an edge.

---

## Development

```bash
git clone <repo>
cd openparse
npm install
npm run build    # compile
npm test         # run tests
npm run eval     # run eval harness (add PDFs to tests/fixtures/ first)
```

---

## Contributing

Contributions welcome. Please open an issue before large PRs.

Priority roadmap:
- [ ] DOCX / PPTX support
- [ ] OpenAI Structured Outputs for JSON mode
- [ ] Table validation pass (numeric consistency checks)
- [ ] Streaming output support
- [ ] CLI watch mode

---

## License

MIT
