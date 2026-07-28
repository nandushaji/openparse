import type { ExtractedPage } from '../types.js'

export interface FastResult {
  markdown: string
  text: string
}

/**
 * Fast mode: no LLM call.
 * - For DOCX pages, uses the pre-rendered markdown from the mammoth extractor.
 * - For PDF pages, converts the text layer to basic markdown via simple heuristics.
 */
export async function processFast(page: ExtractedPage): Promise<FastResult> {
  const raw = page.text.trim()

  if (!raw) {
    return { markdown: '', text: '' }
  }

  // DOCX pages carry pre-converted markdown from the HTML extractor
  const preRendered = (page as ExtractedPage & { _preRenderedMarkdown?: string })._preRenderedMarkdown
  if (preRendered) {
    return { markdown: preRendered, text: raw }
  }

  const markdown = textToBasicMarkdown(raw)
  return { markdown, text: raw }
}

/**
 * Convert plain extracted text to minimal markdown.
 * Rules:
 *  - Short ALL-CAPS lines → heading candidates
 *  - Lines that look like bullet points → keep list markers
 *  - Group consecutive non-blank lines into paragraphs
 */
function textToBasicMarkdown(text: string): string {
  const rawLines = text.split(/\n+/).map(l => l.trim()).filter(Boolean)
  const output: string[] = []

  for (const line of rawLines) {
    if (!line) continue

    // Already a GFM list item
    if (/^[-*•]\s/.test(line) || /^\d+\.\s/.test(line)) {
      output.push(line)
      continue
    }

    // Short, all-caps line that looks like a heading
    if (line.length < 80 && line === line.toUpperCase() && /[A-Z]/.test(line)) {
      output.push(`## ${line}`)
      continue
    }

    output.push(line)
  }

  return output.join('\n\n')
}
