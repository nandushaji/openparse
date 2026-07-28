import type { ExtractedPage } from '../types.js'
import type { Logger } from '../utils/logger.js'

/**
 * Extracts content from a PPTX buffer using JSZip.
 * Each slide becomes a separate ExtractedPage — matching how PDF pages work.
 * Text is extracted from DrawingML (<a:t>) elements preserving slide structure.
 * preRenderedMarkdown is set so fast mode produces clean output without heuristics.
 */
export async function extractPptxPages(
  buffer: Buffer,
  logger: Logger
): Promise<ExtractedPage[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let JSZip: any
  try {
    JSZip = (await import('jszip')).default
  } catch {
    throw new Error(
      'PPTX parsing requires the "jszip" package.\n' +
        '  Install it with: npm install jszip'
    )
  }

  logger.log('Extracting PPTX slides with JSZip…')

  const zip = await JSZip.loadAsync(buffer)

  // Collect slide XML files in slide order
  const slideEntries = Object.keys(zip.files as Record<string, unknown>)
    .filter((name: string) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a: string, b: string) => slideIndex(a) - slideIndex(b))

  logger.log(`PPTX has ${slideEntries.length} slide(s)`)

  const pages: ExtractedPage[] = []

  for (let i = 0; i < slideEntries.length; i++) {
    const xml: string = await (zip.files as Record<string, { async: (t: string) => Promise<string> }>)[slideEntries[i]].async('string')
    const { text, markdown } = extractSlideContent(xml)

    pages.push({
      pageNumber: i + 1,
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      charCount: text.length,
      hasPositionData: false,
      preRenderedMarkdown: markdown,
    })
  }

  return pages
}

function slideIndex(name: string): number {
  return parseInt(name.match(/(\d+)\.xml$/)?.[1] ?? '0', 10)
}

/**
 * Extracts text and builds markdown from a slide XML string.
 * Heuristics:
 *  - First non-empty text run of each text body → heading candidate
 *  - Subsequent runs → paragraph text
 *  - Shapes with >1 paragraph → list-like content
 */
function extractSlideContent(xml: string): { text: string; markdown: string } {
  const mdParts: string[] = []
  const textParts: string[] = []

  // Match each <p:sp> shape element — each shape is a distinct text block
  const shapeRegex = /<p:sp[\s>]([\s\S]*?)<\/p:sp>/g
  let shapeMatch: RegExpExecArray | null

  while ((shapeMatch = shapeRegex.exec(xml)) !== null) {
    const shapeXml = shapeMatch[1]

    // Extract <p:txBody> (PresentationML shape text body) from shape
    const txBodyMatch = shapeXml.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/)
    if (!txBodyMatch) continue

    const txBody = txBodyMatch[1]

    // Check if this is a title placeholder (ph type="title" or "ctrTitle")
    const isTitle =
      /ph\s+type="(?:title|ctrTitle)"/.test(shapeXml) ||
      /ph\s+(?:sz="[^"]*"\s+)?type="(?:title|ctrTitle)"/.test(shapeXml)

    // Extract paragraphs
    const paraRegex = /<a:p>([\s\S]*?)<\/a:p>/g
    let paraMatch: RegExpExecArray | null
    const paraTexts: string[] = []

    while ((paraMatch = paraRegex.exec(txBody)) !== null) {
      const paraXml = paraMatch[1]
      const runs = extractRuns(paraXml)
      if (runs.trim()) paraTexts.push(runs)
    }

    if (paraTexts.length === 0) continue

    const fullText = paraTexts.join('\n')
    textParts.push(fullText)

    if (isTitle || (paraTexts.length === 1 && paraTexts[0].length < 120)) {
      mdParts.push(`## ${paraTexts[0]}`)
    } else {
      mdParts.push(paraTexts.join('\n\n'))
    }
  }

  return {
    text: textParts.join('\n\n'),
    markdown: mdParts.join('\n\n'),
  }
}

/** Pull text from all <a:t> runs inside a paragraph, preserving spacing. */
function extractRuns(paraXml: string): string {
  const parts: string[] = []
  const runRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
  let m: RegExpExecArray | null
  while ((m = runRegex.exec(paraXml)) !== null) {
    parts.push(decodeXmlEntities(m[1]))
  }
  return parts.join('').trim()
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

