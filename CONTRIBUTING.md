# Contributing to @openparse/core

Thank you for your interest in contributing!

## Development setup

```bash
git clone https://github.com/nandushaji/openparse
cd openparse
npm install
npm run build
npm test
```

### Prerequisites

- Node.js 20+
- For agentic mode testing with PDF rendering: `npm install canvas`
- An API key for at least one provider (OpenAI, Anthropic, or a local Ollama instance)

## Running tests

```bash
npm test           # unit tests (no API key needed)
npm run typecheck  # TypeScript strict check
npm run build      # compile to dist/
```

### Live integration tests

Place PDFs in `tests/fixtures/` and run:

```bash
OPENAI_API_KEY=sk-... npm run eval
```

## Project structure

```
src/
  parse.ts          — main orchestrator
  router.ts         — per-page complexity classifier
  merge.ts          — combine pages into ParseResult
  extract/
    text.ts         — pdfjs-dist text layer extraction
    render.ts       — pdfjs-dist + canvas page rendering
  modes/
    fast.ts         — no-LLM text formatting
    costEffective.ts — text → LLM reconstruction
    agentic.ts      — image + text → vision LLM
  llm/
    openai.ts       — OpenAI-compatible HTTP adapter
    anthropic.ts    — Anthropic Messages API adapter
  utils/
    retry.ts        — exponential backoff
    concurrency.ts  — async pool
    pages.ts        — page range parsing
tests/              — vitest unit tests
examples/           — runnable examples
scripts/eval.ts     — eval harness
```

## Adding a new provider adapter

1. Create `src/llm/<provider>.ts` implementing the `LLMClient` interface:

```ts
import type { LLMClient, LLMRequest, LLMResponse } from '../types.js'

export class MyProviderClient implements LLMClient {
  async chat(request: LLMRequest): Promise<LLMResponse> {
    // Translate LLMRequest → your API format
    // Return { content: string, tokensUsed?: number }
  }
}
```

2. Export it from `src/llm/index.ts` and add a case to `createLLMClient`.
3. Export from `src/index.ts`.
4. Add an example in `examples/`.

## Adding a file format

1. Detect the extension in `src/parse.ts` → `resolveInput`.
2. Return `{ buffer, filename, isImage: false }` (treat as multi-page).
3. Add extraction logic in `src/extract/` that returns `ExtractedPage[]`.
4. Wire into `parse.ts`.

## Coding standards

- TypeScript strict mode — no `any` unless absolutely necessary (cast to `unknown` first)
- No `console.log` in library code — use the `Logger` from `src/utils/logger.ts`
- New public API surface must be typed and exported from `src/index.ts`
- Tests for new functionality in `tests/`

## Commit style

```
feat: add Gemini provider adapter
fix: handle empty PDF pages in fast mode
docs: add Groq example
test: router correctly classifies borderless tables
chore: bump pdfjs-dist to 4.10
```

## Release process (maintainers)

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Commit: `chore: release v0.2.0`
4. Tag: `git tag v0.2.0 && git push origin v0.2.0`
5. GitHub Actions publishes to npm automatically.
