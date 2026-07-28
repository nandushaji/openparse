import type { ExtractedPage } from '../types.js'
import type { Logger } from '../utils/logger.js'
import { htmlToMarkdown } from '../utils/htmlToMarkdown.js'

/**
 * Extracts content from plain-text formats: TXT, Markdown, RTF, HTML.
 * All treated as single-page documents.
 */
export async function extractPlaintextPage(
  buffer: Buffer,
  ext: string,
  logger: Logger
): Promise<ExtractedPage[]> {
  let text = buffer.toString('utf-8')
  let markdown: string

  switch (ext) {
    case '.html':
    case '.htm': {
      logger.log('Parsing HTML file…')
      // Strip <head>, <script>, <style> blocks first
      text = text
        .replace(/<head[\s\S]*?<\/head>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
      markdown = htmlToMarkdown(text)
      // Plain text is the markdown without markup
      text = markdown.replace(/[#*`\[\]|>_~\\]/g, '').replace(/\n{3,}/g, '\n\n').trim()
      break
    }

    case '.md':
    case '.markdown': {
      logger.log('Parsing Markdown file…')
      // Markdown is already the output format — pass through directly
      markdown = text.trim()
      break
    }

    case '.rtf': {
      logger.log('Parsing RTF file (text-only extraction)…')
      // RTF is complex binary-ish format; strip control words for plain text
      text = stripRtf(text)
      markdown = text
      break
    }

    case '.txt':
    default: {
      logger.log('Parsing plain text file…')
      markdown = text.trim()
      break
    }
  }

  const words = text.split(/\s+/).filter(Boolean)

  return [
    {
      pageNumber: 1,
      text: text.trim(),
      wordCount: words.length,
      charCount: text.length,
      hasPositionData: false,
      preRenderedMarkdown: markdown,
    },
  ]
}

/**
 * Minimal RTF → plain text stripper.
 * Handles common control words; good enough for text extraction.
 * Full RTF parsing would require a dedicated library.
 */
function stripRtf(rtf: string): string {
  // Remove RTF header and groups
  let text = rtf
  // Remove escaped characters like \', \n, \r
  text = text.replace(/\\'/g, "'")
  // Handle common RTF control sequences that produce newlines/spaces
  text = text.replace(/\\par\b/g, '\n')
  text = text.replace(/\\line\b/g, '\n')
  text = text.replace(/\\tab\b/g, '\t')
  text = text.replace(/\\[a-z]+\d* ?/g, '')   // strip all other control words
  text = text.replace(/[{}]/g, '')              // strip group delimiters
  text = text.replace(/\\\\/g, '\\')            // unescape backslashes
  text = text.replace(/\r/g, '')
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  return text
}
