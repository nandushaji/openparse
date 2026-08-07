# Changelog

All notable changes to `@openparse/core` will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)  
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [Unreleased]

## [0.3.4] — 2026-08-08

### Fixed
- **`canvas` peerDependency declared** — restored the explicit `peerDependencies.canvas`
  entry so optional peer metadata is valid and installers resolve the peer correctly.
- **CLI `--version`** — reports the real package version via `__LIB_VERSION__` instead of a
  hard-coded `0.1.0`.
- **Agentic fallback docs** — clarified that missing page images return the raw text layer
  (no LLM call), not a `cost_effective` pass.

### Changed
- **README** — rewritten against current behavior: format coverage, `parseStream` limits,
  modes / `canvas` requirements, API reference, and roadmap.

## [0.3.3] — 2026-07-30

### Added
- **`client` option on `parse()` / `parseStream()`** — inject a pre-built `LLMClient`
  (`OpenAIClient`, `AnthropicClient`, `createLLMClient()`, or a custom implementation).
  When set, `apiKey` / `baseUrl` / `provider` are not used for client construction.
- **Options-object constructors** — `new OpenAIClient({ apiKey, baseUrl? })` and
  `new AnthropicClient({ apiKey, baseUrl? })`. Positional `(apiKey, baseUrl?)` still works.

### Fixed
- **pdfjs legacy warning** — actually uses `pdfjs-dist/legacy/build/pdf.mjs` in Node instead of
  suppressing a `console.warn` that never fired (pdfjs logs via `console.log`). The
  "Please use the `legacy` build in Node.js environments" message is gone.
- Clear `TypeError` when `OpenAIClient` / `AnthropicClient` are constructed with an invalid
  argument shape (previously crashed inside URL trimming with an opaque error).

## [0.3.2] — 2026-07-28

### Fixed
- **pdfjs warning suppressed** — attempted to intercept the legacy-build advisory during
  initialization (incomplete — see 0.3.3 for the real fix).
- **`page.mode` now populated** — `PageResult` now exposes `mode` (primary field) alongside the
  existing `modeUsed` alias so `result.pages[0].mode` returns `'fast'` / `'cost_effective'` / `'agentic'`.
- **`items` omitted in fast-only runs** — when every page is processed in fast mode (no LLM call),
  `ParseResult.items` is `undefined` instead of `{ headings: [], tables: [] }`. Heading and table
  detection requires LLM-generated markdown structure.
- **`metadata.model` is `null` in fast mode** — avoids the misleading `"model": "gpt-4o-mini"`
  appearing in metadata when no LLM was invoked.
- **Out-of-range `pages` option throws `InvalidDocumentError`** — `pages: '100-200'` on a 14-page
  PDF now throws with a clear message instead of silently returning `{ pages: [] }`.
- **Typed errors exported** — `OpenParseError`, `InvalidDocumentError`, `UnsupportedFormatError`
  are now exported from the package so callers can `instanceof`-check specific error kinds.

## [0.3.1] — 2026-07-28

### Security
- Moved `canvas` from `optionalDependencies` to an optional `peerDependency` — users who
  don't need agentic (vision-LLM) mode now install zero native packages and see zero
  deprecation warnings. To enable agentic mode: `npm install canvas`.

## [0.3.0] — 2026-07-28

### Added
- **PPTX support** — one `ExtractedPage` per slide, text extracted via built-in SpreadsheetML / PresentationML reader
- **XLSX / CSV / TSV support** — sheets rendered as GFM tables with zero-CVE custom parser (no SheetJS/xlsx dependency)
- **HTML, Markdown, TXT, RTF support** — lightweight plain-text extraction with HTML-to-Markdown conversion
- **`parseStream()` AsyncGenerator API** — yields `PageResult` items one at a time for real-time streaming
- **Cost guards** — `maxPages` and `maxTokenBudget` options; `CostLimitError` carries partial results when budget is exceeded

### Security
- Upgraded `canvas` optional dependency from v2 → v3, eliminating a chain of CVEs in `tar`, `glob`, `rimraf`, and `@mapbox/node-pre-gyp`
- Replaced `xlsx` (SheetJS — unresolvable prototype-pollution CVE) with a custom zero-dependency XLSX reader using the already-bundled `jszip`
- Upgraded `vitest` dev dependency to v4 (patches critical arbitrary-file-read CVE in Vitest UI)
- Total audit profile: **0 production CVEs** (down from 7 high + 1 critical)

### Fixed
- Test fixture race condition on Node 22 multi-worker runs (moved to `globalSetup` with atomic writes)
- ReDoS in URL-trimming helpers (replaced regex with character-by-character iteration)

## [0.2.0] — 2026-07-28

### Added

- **DOCX support** — `.docx` files (and DOCX Buffers) are now parsed via `mammoth`.
  Headings, bold/italic, lists, links, and tables are converted to GitHub-Flavored Markdown.
- **Buffer image detection** — passing an image `Buffer` (PNG, JPEG, WebP, GIF) is now
  correctly routed to image/agentic mode instead of always being treated as PDF.
- **Real integration tests** — 8 new tests run the full `parse()` pipeline against an actual
  PDF fixture with no LLM required, covering Buffer round-trips, progress callbacks, page ranges,
  and result shape validation.

### Changed

- `metadata.version` in `ParseResult` is now injected at build time from `package.json`
  via `tsup` `define`, so it stays accurate automatically across releases.
- Vitest config (`vitest.config.ts`) added so `__LIB_VERSION__` is available during test runs.
- Error message for unsupported file types updated to reflect DOCX is now supported.

### Fixed

- `Buffer` inputs that are images no longer silently fail inside the PDF parser.

## [0.1.0] — 2026-07-28

### Added

- `parse()` API: accepts file path, Buffer, or HTTP(S) URL
- **Three parsing modes** with automatic per-page routing:
  - `fast` — text layer formatting, zero LLM cost
  - `cost_effective` — text layer → LLM structure reconstruction
  - `agentic` — page image + text layer → vision LLM (requires `canvas`)
  - `auto` (default) — complexity router picks mode per page
- **Provider support** via thin HTTP adapters:
  - OpenAI and any OpenAI-compatible endpoint (Ollama, Groq, Azure, LM Studio)
  - Anthropic Messages API (Claude models)
- **Input formats:** PDF, PNG, JPEG, WebP, HTTP(S) URLs
- **Output formats:** `markdown`, `text`, `json` (structured headings/tables/paragraphs)
- Per-page complexity router using text density, pipe/tab density, and x-position clustering
- Exponential backoff retry on transient LLM errors
- Configurable concurrency pool to control rate limit exposure and cost
- Page range selection (`pages: '1-5,8'`)
- Progress hooks: `onProgress`, `onPageComplete`
- Partial failure: page errors recorded in `result.errors[]`; other pages succeed
- Usage reporting: token count, pages-by-mode breakdown, duration
- CLI (`openparse` / `op` binary) with full option parity to the JS API
- Eval harness script for fixture-based benchmarking
- MIT license

[Unreleased]: https://github.com/nandushaji/openparse/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nandushaji/openparse/releases/tag/v0.1.0
