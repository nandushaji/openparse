import type {
  PageResult,
  ParseResult,
  ParseResultItems,
  UsageInfo,
  ResultType,
} from './types.js'

const LIB_VERSION = __LIB_VERSION__

export function mergeResults(
  pages: PageResult[],
  errors: Array<{ pageNumber: number; error: string }>,
  filename: string,
  model: string,
  resultType: ResultType,
  durationMs: number
): ParseResult {
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber)

  const markdown = sorted
    .map(p => p.markdown)
    .filter(Boolean)
    .join('\n\n---\n\n')

  const text = sorted
    .map(p => p.text)
    .filter(Boolean)
    .join('\n\n')

  const pagesByMode: Record<string, number> = {}
  let estimatedTokens = 0

  for (const p of sorted) {
    pagesByMode[p.modeUsed] = (pagesByMode[p.modeUsed] ?? 0) + 1
    estimatedTokens += p.tokensUsed ?? 0
  }

  const usage: UsageInfo = {
    totalPages: sorted.length,
    pagesByMode,
    estimatedTokens,
    durationMs,
  }

  const items: ParseResultItems | undefined =
    resultType === 'json' ? extractItems(sorted) : undefined

  return {
    markdown,
    text,
    pages: sorted,
    items,
    usage,
    metadata: {
      filename,
      pageCount: sorted.length,
      durationMs,
      model,
      version: LIB_VERSION,
    },
    errors,
  }
}

function extractItems(pages: PageResult[]): ParseResultItems {
  const headings: ParseResultItems['headings'] = []
  const tables: ParseResultItems['tables'] = []
  const paragraphs: ParseResultItems['paragraphs'] = []

  for (const page of pages) {
    const lines = page.markdown.split('\n')

    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()

      // Heading
      const hMatch = trimmed.match(/^(#{1,6})\s+(.+)/)
      if (hMatch) {
        headings.push({ level: hMatch[1].length, text: hMatch[2], pageNumber: page.pageNumber })
        i++
        continue
      }

      // Table: collect consecutive pipe-leading lines
      if (trimmed.startsWith('|')) {
        const tableLines: string[] = [line]
        while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
          i++
          tableLines.push(lines[i])
        }
        tables.push({ markdown: tableLines.join('\n'), pageNumber: page.pageNumber })
        i++
        continue
      }

      // Non-empty, non-structural line → paragraph
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('|')) {
        paragraphs.push({ text: trimmed, pageNumber: page.pageNumber })
      }

      i++
    }
  }

  return { headings, tables, paragraphs }
}
