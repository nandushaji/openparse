import type { ExtractedPage, LLMClient, LLMRequest, LLMMessage } from '../types.js'
import type { Logger } from '../utils/logger.js'
import { bufferToDataUrl } from '../utils/base64.js'

export interface AgenticResult {
  markdown: string
  text: string
  hasScreenshot: boolean
  tokensUsed?: number
}

const SYSTEM_PROMPT = `You are a high-accuracy document parser. You will be given a page image (and optionally its extracted text layer).

Your task:
1. Use the IMAGE as the primary source of truth for layout, structure, tables, and visual elements
2. Use the text layer (if provided) to improve text accuracy and OCR quality
3. Output clean, well-structured GitHub-Flavored Markdown

Rules:
- Preserve ALL content — no omissions, summaries, or paraphrasing
- Tables: reconstruct as GFM tables with correct rows, columns, and alignment
- Multi-column text: merge into logical reading order
- Charts/diagrams: describe the data and key values in a structured way
- Headings: use # notation based on visual hierarchy
- Code/formulas: use fenced code blocks with the correct language tag
- Do NOT add any preamble, commentary, or explanation
- Output ONLY the Markdown`

/**
 * Agentic mode: sends the page image + text layer to a vision LLM.
 * Falls back to text-only (cost_effective) if image rendering is unavailable.
 */
export async function processAgentic(
  page: ExtractedPage,
  imageBuffer: Buffer | null,
  client: LLMClient,
  model: string,
  temperature: number,
  logger: Logger,
  instructions?: string
): Promise<AgenticResult> {
  const ext = page as ExtractedPage & { _imageMime?: string; _imageBuffer?: Buffer }
  const directImage = ext._imageBuffer ?? null
  const directMime = ext._imageMime ?? 'image/png'

  // Resolve image: prefer pre-rendered buffer, then direct image input
  const img = imageBuffer ?? directImage
  const mime = imageBuffer ? 'image/png' : directMime

  if (!img) {
    // No image available — degrade gracefully to text-only
    logger.warn(
      `Page ${page.pageNumber}: no image available for agentic mode, falling back to text-only`
    )
    if (!page.text.trim()) {
      return { markdown: '', text: '', hasScreenshot: false }
    }
    return {
      markdown: page.text,
      text: page.text,
      hasScreenshot: false,
    }
  }

  const system = instructions
    ? `${SYSTEM_PROMPT}\n\nAdditional instructions from the user:\n${instructions}`
    : SYSTEM_PROMPT

  const userParts: LLMMessage['content'] = [
    {
      type: 'image_url',
      image_url: { url: bufferToDataUrl(img, mime), detail: 'high' },
    },
  ]

  if (page.text.trim()) {
    ;(userParts as Array<{ type: string; text?: string; image_url?: unknown }>).push({
      type: 'text',
      text: `Text layer (use to improve accuracy):\n${page.text}`,
    })
  } else {
    ;(userParts as Array<{ type: string; text?: string; image_url?: unknown }>).push({
      type: 'text',
      text: 'Extract all content from the image and convert to Markdown.',
    })
  }

  const request: LLMRequest = {
    model,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userParts },
    ],
  }

  const response = await client.chat(request)
  const markdown = stripFences(response.content.trim())

  return {
    markdown,
    text: page.text,
    hasScreenshot: true,
    tokensUsed: response.tokensUsed,
  }
}

function stripFences(text: string): string {
  return text.replace(/^```(?:markdown)?\n?([\s\S]*?)\n?```$/, '$1').trim()
}
