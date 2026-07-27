/**
 * Evaluation harness: parse a set of fixture files and record results.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... tsx scripts/eval.ts
 *
 * Place PDF/image files in tests/fixtures/ before running.
 * Results are written to scripts/eval-output/<timestamp>/
 */
import { readdir, mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
// When using as an installed package: import { parse } from '@openparse/core'
import { parse } from '../src/index.js'

const FIXTURE_DIR = path.join(process.cwd(), 'tests/fixtures')
const OUTPUT_DIR = path.join(process.cwd(), 'scripts/eval-output', new Date().toISOString().slice(0, 16).replace('T', '_'))

const SUPPORTED = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp'])

async function main() {
  const apiKey = process.env['OPENAI_API_KEY']
  if (!apiKey) {
    console.error('Set OPENAI_API_KEY to run the eval harness.')
    process.exit(1)
  }

  const files = (await readdir(FIXTURE_DIR)).filter(f => {
    const ext = path.extname(f).toLowerCase()
    return SUPPORTED.has(ext) && !f.startsWith('.')
  })

  if (files.length === 0) {
    console.log(`No fixture files found in ${FIXTURE_DIR}`)
    console.log('Add PDF or image files to tests/fixtures/ and re-run.')
    return
  }

  await mkdir(OUTPUT_DIR, { recursive: true })

  const summary: Array<{
    file: string
    pages: number
    durationMs: number
    tokens: number
    pagesByMode: Record<string, number>
    errors: number
  }> = []

  for (const file of files) {
    const filePath = path.join(FIXTURE_DIR, file)
    console.log(`\nParsing ${file}…`)

    try {
      const result = await parse(filePath, {
        apiKey,
        mode: 'auto',
        model: 'gpt-4o-mini',
        onProgress({ pagesComplete, totalPages }) {
          process.stdout.write(`\r  ${pagesComplete}/${totalPages} pages`)
        },
      })
      process.stdout.write('\n')

      const base = path.basename(file, path.extname(file))
      await writeFile(path.join(OUTPUT_DIR, `${base}.md`), result.markdown)
      await writeFile(
        path.join(OUTPUT_DIR, `${base}.meta.json`),
        JSON.stringify({ usage: result.usage, errors: result.errors }, null, 2)
      )

      summary.push({
        file,
        pages: result.usage.totalPages,
        durationMs: result.usage.durationMs,
        tokens: result.usage.estimatedTokens,
        pagesByMode: result.usage.pagesByMode,
        errors: result.errors.length,
      })

      console.log(
        `  ✓ ${result.usage.totalPages} pages | ` +
        `~${result.usage.estimatedTokens} tokens | ` +
        `${result.usage.durationMs}ms | ` +
        `modes: ${JSON.stringify(result.usage.pagesByMode)}`
      )
    } catch (err) {
      console.error(`  ✗ ${file}: ${(err as Error).message}`)
      summary.push({ file, pages: 0, durationMs: 0, tokens: 0, pagesByMode: {}, errors: 1 })
    }
  }

  await writeFile(path.join(OUTPUT_DIR, '_summary.json'), JSON.stringify(summary, null, 2))

  console.log(`\n\nEval complete. Results written to:\n  ${OUTPUT_DIR}`)

  const totals = summary.reduce(
    (acc, s) => ({
      pages: acc.pages + s.pages,
      tokens: acc.tokens + s.tokens,
      ms: acc.ms + s.durationMs,
      errors: acc.errors + s.errors,
    }),
    { pages: 0, tokens: 0, ms: 0, errors: 0 }
  )

  console.log(
    `\nTotals: ${summary.length} files | ${totals.pages} pages | ` +
    `~${totals.tokens} tokens | ${totals.ms}ms | ${totals.errors} errors`
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
