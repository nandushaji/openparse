/**
 * Basic usage: parse a PDF with OpenAI gpt-4o-mini in auto mode.
 * Run: OPENAI_API_KEY=sk-... tsx examples/basic.ts ./your-file.pdf
 */
// When using as an installed package: import { parse } from '@openparse/core'
import { parse } from '../src/index.js'

const filePath = process.argv[2] ?? './document.pdf'

const result = await parse(filePath, {
  apiKey: process.env['OPENAI_API_KEY'],
  model: 'gpt-4o-mini',
  mode: 'auto',
  onProgress({ pagesComplete, totalPages, percent }) {
    process.stderr.write(`\r  ${pagesComplete}/${totalPages} pages (${percent}%)`)
  },
})

process.stderr.write('\n')
console.log(result.markdown)

console.error('\n--- Usage ---')
console.error(`Pages:    ${result.usage.totalPages}`)
console.error(`By mode:  ${JSON.stringify(result.usage.pagesByMode)}`)
console.error(`Tokens:   ~${result.usage.estimatedTokens}`)
console.error(`Duration: ${result.usage.durationMs}ms`)

if (result.errors.length > 0) {
  console.error('\nErrors:')
  for (const e of result.errors) {
    console.error(`  Page ${e.pageNumber}: ${e.error}`)
  }
}
