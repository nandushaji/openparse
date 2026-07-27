import type { ExtractedPage, LLMClient, LLMRequest } from '../types.js'

export interface CostEffectiveResult {
  markdown: string
  text: string
  tokensUsed?: number
}

const SYSTEM_PROMPT = `You are a precise document parser. Convert the provided document page text into clean, well-structured GitHub-Flavored Markdown.

Rules:
- Preserve ALL content accurately — do not omit, summarise, or paraphrase
- Use # ## ### for headings based on visual/semantic hierarchy in the text
- Reconstruct tables as GFM tables with | column | separators | and a separator row
- Use - for unordered lists, 1. 2. for ordered lists
- Wrap inline code with backticks; fenced code blocks with triple backticks
- Do NOT add any commentary, preamble, or explanation outside the document content
- Output ONLY the formatted Markdown`

/**
 * Cost-effective mode: send the text layer to a language model for structure
 * reconstruction. Uses text only (no screenshot). Good for most digital PDFs.
 */
export async function processCostEffective(
  page: ExtractedPage,
  client: LLMClient,
  model: string,
  temperature: number,
  instructions?: string
): Promise<CostEffectiveResult> {
  const rawText = page.text.trim()

  if (!rawText) {
    return { markdown: '', text: '' }
  }

  const system = instructions
    ? `${SYSTEM_PROMPT}\n\nAdditional instructions from the user:\n${instructions}`
    : SYSTEM_PROMPT

  const request: LLMRequest = {
    model,
    temperature,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Convert this document page to Markdown:\n\n${rawText}`,
      },
    ],
  }

  const response = await client.chat(request)
  const markdown = stripFences(response.content.trim())

  return {
    markdown,
    text: rawText,
    tokensUsed: response.tokensUsed,
  }
}

/** Strip wrapping ```markdown ... ``` if the model added them. */
function stripFences(text: string): string {
  return text.replace(/^```(?:markdown)?\n?([\s\S]*?)\n?```$/, '$1').trim()
}
