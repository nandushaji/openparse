import type { ExtractedPage } from '../types.js'
import type { Logger } from '../utils/logger.js'
import { htmlToMarkdown } from '../utils/htmlToMarkdown.js'

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

