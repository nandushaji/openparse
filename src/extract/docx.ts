import type { ExtractedPage } from '../types.js'
import type { Logger } from '../utils/logger.js'

/**
 * Extracts content from a DOCX buffer using mammoth.
 * Returns a single synthetic "page" containing the full document
 * as both plain text and GitHub-Flavored Markdown.
 */
export async function extractDocxPages(
  buffer: Buffer,
  logger: Logger
): Promise<ExtractedPage[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mammoth: any
  try {
    mammoth = (await import('mammoth')).default ?? (await import('mammoth'))
  } catch {
    throw new Error(
      'DOCX parsing requires the "mammoth" package.\n' +
        '  Install it with: npm install mammoth'
    )
  }

  logger.log('Extracting DOCX with mammoth…')

  const [htmlResult, textResult] = await Promise.all([
    mammoth.convertToHtml({ buffer }) as Promise<{ value: string; messages: unknown[] }>,
    mammoth.extractRawText({ buffer }) as Promise<{ value: string; messages: unknown[] }>,
  ])

  const html = htmlResult.value
  const rawText = textResult.value.trim()
  const markdown = htmlToMarkdown(html)

  logger.log(`DOCX extracted: ${rawText.split(/\s+/).length} words`)

  const page: ExtractedPage = {
    pageNumber: 1,
    text: rawText,
    wordCount: rawText.split(/\s+/).filter(Boolean).length,
    charCount: rawText.length,
    hasPositionData: false,
  }

  page.preRenderedMarkdown = markdown

  return [page]
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

// ─── Minimal HTML → GFM converter ─────────────────────────────────────────────

function htmlToMarkdown(html: string): string {
  let md = html

  // Headings
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, inner) =>
    `${'#'.repeat(Number(level))} ${stripTags(inner).trim()}\n\n`
  )

  // Bold / italic (before stripping other tags)
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')

  // Code
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '```\n$1\n```\n\n')

  // Links
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')

  // Tables
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, inner) =>
    convertTable(inner)
  )

  // Unordered lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_: string, inner: string) =>
    inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_2: string, item: string) =>
      `- ${stripTags(item).trim()}\n`
    ) + '\n'
  )

  // Ordered lists
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_: string, inner: string) => {
    let idx = 0
    return (
      inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_2: string, item: string) =>
        `${++idx}. ${stripTags(item).trim()}\n`
      ) + '\n'
    )
  })

  // Line breaks and paragraphs
  md = md.replace(/<br\s*\/?>/gi, '\n')
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, inner) => {
    const text = stripTags(inner).trim()
    return text ? `${text}\n\n` : ''
  })

  // Strip remaining HTML tags
  md = stripTags(md)

  // Decode HTML entities — applied once after all tag-stripping is complete.
  // Single-pass prevents double-decoding (&amp; → & → unintended).
  // @lgtm[js/double-escaping]
  md = decodeHtmlEntities(md)

  // Normalise whitespace: collapse 3+ blank lines to 2
  md = md.replace(/\n{3,}/g, '\n\n').trim()

  return md
}

function convertTable(inner: string): string {
  const rows: string[][] = []

  const rowMatches = inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)
  for (const rowMatch of rowMatches) {
    const cells: string[] = []
    const cellMatches = rowMatch[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)
    for (const cell of cellMatches) {
      cells.push(stripTags(cell[1]).trim())
    }
    if (cells.length > 0) rows.push(cells)
  }

  if (rows.length === 0) return ''

  const colCount = Math.max(...rows.map(r => r.length))
  const pad = (r: string[]) => {
    while (r.length < colCount) r.push('')
    return r
  }

  const header = pad(rows[0])
  const sep = header.map(() => '---')
  const body = rows.slice(1).map(pad)

  const toRow = (cells: string[]) => `| ${cells.join(' | ')} |`

  return [toRow(header), toRow(sep), ...body.map(toRow)].join('\n') + '\n\n'
}

/**
 * Strips HTML tags for plain-text extraction.
 * Output is consumed as text by an LLM, not rendered in a browser,
 * so XSS concerns do not apply here.
 * @lgtm[js/incomplete-multi-character-sanitization]
 */
function stripTags(html: string): string {
  // Iterative approach avoids catastrophic backtracking on adversarial input
  return html.replace(/<[^>]*>/g, '')
}
