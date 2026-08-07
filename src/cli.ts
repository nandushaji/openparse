import { Command } from 'commander'
import fs from 'fs/promises'
import { parse } from './parse.js'
import type { ParseMode, ResultType, LLMProvider } from './types.js'

const program = new Command()

program
  .name('openparse')
  .description(
    'Open-source LlamaParse-like document parsing. Bring your own LLM key.\n' +
    'Package: @openparse/core  |  Docs: https://github.com/nandushaji/openparse'
  )
  .version(typeof __LIB_VERSION__ !== 'undefined' ? __LIB_VERSION__ : '0.0.0')

program
  .argument('<file>', 'Path to a PDF or image file, or an HTTP(S) URL')
  .option('-m, --mode <mode>', 'Parsing mode: fast | cost_effective | agentic | auto', 'auto')
  .option('--model <model>', 'LLM model name (default depends on mode)')
  .option('--api-key <key>', 'LLM API key (or set OPENAI_API_KEY / ANTHROPIC_API_KEY)')
  .option('--base-url <url>', 'Custom API base URL (Ollama: http://localhost:11434/v1)')
  .option('--provider <p>', 'Provider: openai | anthropic | compatible', 'openai')
  .option('--result-type <type>', 'Output: markdown | text | json', 'markdown')
  .option('--pages <range>', 'Page range to process, e.g. "1-5,8" (PDF only)')
  .option('-c, --concurrency <n>', 'Max concurrent page requests', '3')
  .option('--dpi <n>', 'Render DPI for agentic mode', '150')
  .option('--instructions <text>', 'Custom parsing instructions sent to the LLM')
  .option('-o, --out <path>', 'Write output to this file (default: stdout)')
  .option('--json', 'Shorthand for --result-type json')
  .option('--debug', 'Enable verbose debug logging to stderr')
  .action(async (file: string, opts) => {
    try {
      const mode = opts.mode as ParseMode
      const resultType: ResultType = opts.json ? 'json' : (opts.resultType as ResultType)
      const provider = opts.provider as LLMProvider

      const result = await parse(file, {
        mode,
        model: opts.model as string | undefined,
        apiKey: opts.apiKey as string | undefined,
        baseUrl: opts.baseUrl as string | undefined,
        provider,
        resultType,
        pages: opts.pages as string | undefined,
        concurrency: parseInt(opts.concurrency as string, 10),
        dpi: parseInt(opts.dpi as string, 10),
        instructions: opts.instructions as string | undefined,
        debug: Boolean(opts.debug),
        onProgress({ pagesComplete, totalPages, percent }) {
          if (process.stderr.isTTY) {
            process.stderr.write(`\r  Parsing ${pagesComplete}/${totalPages} pages (${percent}%)   `)
          }
        },
      })

      if (process.stderr.isTTY) process.stderr.write('\n')

      let output: string
      if (resultType === 'json') {
        output = JSON.stringify(result, null, 2)
      } else if (resultType === 'text') {
        output = result.text
      } else {
        output = result.markdown
      }

      if (opts.out) {
        await fs.writeFile(opts.out as string, output, 'utf-8')
        process.stderr.write(`Saved to ${opts.out}\n`)
      } else {
        process.stdout.write(output)
        if (!output.endsWith('\n')) process.stdout.write('\n')
      }

      // Usage summary
      const { usage } = result
      const modeSummary = Object.entries(usage.pagesByMode)
        .map(([m, n]) => `${m}: ${n}`)
        .join(', ')
      process.stderr.write(
        `\nDone in ${usage.durationMs}ms | ` +
          `Pages: ${usage.totalPages} (${modeSummary}) | ` +
          `Tokens: ~${usage.estimatedTokens}\n`
      )

      if (result.errors.length > 0) {
        process.stderr.write(
          `⚠ Errors on page(s): ${result.errors.map(e => e.pageNumber).join(', ')}\n`
        )
        process.exitCode = 1
      }
    } catch (err) {
      process.stderr.write(`Error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program.parse()
