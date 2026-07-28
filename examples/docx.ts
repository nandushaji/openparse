/**
 * DOCX parsing example — no LLM required for fast mode.
 * Install: npm install @openparse/core
 */
import { parse } from '@openparse/core'

const result = await parse('path/to/document.docx', {
  mode: 'fast',        // free — mammoth HTML → markdown, no LLM
  // mode: 'cost_effective',  // uncomment to use LLM for better formatting
  // apiKey: process.env.OPENAI_API_KEY,
})

console.log(result.markdown)
console.log('\nUsage:', result.usage)
