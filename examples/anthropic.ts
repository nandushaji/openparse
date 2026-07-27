/**
 * Anthropic example: parse with Claude using the Anthropic adapter.
 *
 * Run: ANTHROPIC_API_KEY=sk-ant-... tsx examples/anthropic.ts ./your-file.pdf
 */
// When using as an installed package: import { parse } from '@openparse/core'
import { parse } from '../src/index.js'

const filePath = process.argv[2] ?? './document.pdf'

const result = await parse(filePath, {
  apiKey: process.env['ANTHROPIC_API_KEY'],
  model: 'claude-3-5-haiku-20241022',  // Cost-effective; use claude-3-5-sonnet for agentic
  provider: 'anthropic',
  mode: 'auto',
  instructions: 'Preserve all table structures carefully. Use proper GFM table syntax.',
  onProgress({ pagesComplete, totalPages }) {
    process.stderr.write(`\r  Page ${pagesComplete}/${totalPages}`)
  },
})

process.stderr.write('\n')
console.log(result.markdown)
console.error(`\nTokens: ~${result.usage.estimatedTokens} | Time: ${result.usage.durationMs}ms`)
