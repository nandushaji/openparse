# Changelog

All notable changes to `@openparse/core` will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)  
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [Unreleased]

## [0.1.0] — 2024-01-01

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

[Unreleased]: https://github.com/yourusername/openparse/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yourusername/openparse/releases/tag/v0.1.0
