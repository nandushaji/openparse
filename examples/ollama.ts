/**
 * Ollama example: parse locally with a free, self-hosted vision model.
 *
 * Prerequisites:
 *   1. Install Ollama: https://ollama.com
 *   2. Pull a vision model:  ollama pull llava
 *      (or moondream, llama3.2-vision, etc.)
 *   3. Run: tsx examples/ollama.ts ./your-file.pdf
 *
 * Cost: $0 — runs entirely on your machine.
 */
// When using as an installed package: import { parse } from '@openparse/core'
import { parse } from '../src/index.js'

const filePath = process.argv[2] ?? './document.pdf'

const result = await parse(filePath, {
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',           // Ollama ignores the key but the field is required
  model: 'llava:latest',      // Change to any vision-capable model you have pulled
  provider: 'compatible',     // Use the OpenAI-compatible adapter
  mode: 'cost_effective',     // Local models shine on structured text; use agentic for scans
  onProgress({ pagesComplete, totalPages }) {
    process.stderr.write(`\r  Processing page ${pagesComplete}/${totalPages}…`)
  },
})

process.stderr.write('\n')
console.log(result.markdown)
console.error(`\nDone in ${result.usage.durationMs}ms`)
