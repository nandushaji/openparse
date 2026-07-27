import { describe, it, expect, vi } from 'vitest'
import { processFast } from '../src/modes/fast.js'
import { processCostEffective } from '../src/modes/costEffective.js'
import type { ExtractedPage, LLMClient } from '../src/types.js'

function makeExtractedPage(text: string, pageNumber = 1): ExtractedPage {
  return {
    pageNumber,
    text,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    charCount: text.length,
    hasPositionData: false,
  }
}

// ─── Fast mode ────────────────────────────────────────────────────────────────

describe('processFast', () => {
  it('returns the text layer as markdown', async () => {
    const page = makeExtractedPage('This is a document page with several words.')
    const result = await processFast(page)
    expect(result.markdown).toBeTruthy()
    expect(result.text).toBe(page.text)
  })

  it('returns empty strings for an empty page', async () => {
    const page = makeExtractedPage('')
    const result = await processFast(page)
    expect(result.markdown).toBe('')
    expect(result.text).toBe('')
  })

  it('formats an ALL-CAPS line as a heading', async () => {
    const page = makeExtractedPage('SECTION ONE\nThis is the body text for section one.')
    const result = await processFast(page)
    expect(result.markdown).toContain('## SECTION ONE')
  })

  it('preserves list markers', async () => {
    const page = makeExtractedPage('- Item one\n- Item two\n- Item three')
    const result = await processFast(page)
    expect(result.markdown).toContain('- Item one')
  })
})

// ─── Cost-effective mode ──────────────────────────────────────────────────────

describe('processCostEffective', () => {
  it('calls the LLM and returns cleaned markdown', async () => {
    const mockClient: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        content: '# Title\n\nSome body text.',
        tokensUsed: 50,
      }),
    }

    const page = makeExtractedPage('Title\n\nSome body text.')
    const result = await processCostEffective(page, mockClient, 'gpt-4o-mini', 0)

    expect(result.markdown).toBe('# Title\n\nSome body text.')
    expect(result.tokensUsed).toBe(50)
    expect(mockClient.chat).toHaveBeenCalledOnce()
  })

  it('strips code fences if the model wraps output in them', async () => {
    const mockClient: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        content: '```markdown\n# Heading\n\nParagraph.\n```',
        tokensUsed: 20,
      }),
    }

    const page = makeExtractedPage('Heading\n\nParagraph.')
    const result = await processCostEffective(page, mockClient, 'gpt-4o-mini', 0)

    expect(result.markdown).toBe('# Heading\n\nParagraph.')
  })

  it('returns empty strings for an empty page without calling LLM', async () => {
    const mockClient: LLMClient = { chat: vi.fn() }
    const page = makeExtractedPage('')
    const result = await processCostEffective(page, mockClient, 'gpt-4o-mini', 0)

    expect(result.markdown).toBe('')
    expect(mockClient.chat).not.toHaveBeenCalled()
  })

  it('includes custom instructions in the system prompt', async () => {
    let capturedRequest: Parameters<LLMClient['chat']>[0] | null = null
    const mockClient: LLMClient = {
      chat: vi.fn().mockImplementation(async req => {
        capturedRequest = req
        return { content: 'result', tokensUsed: 10 }
      }),
    }

    const page = makeExtractedPage('Some content.')
    await processCostEffective(page, mockClient, 'gpt-4o-mini', 0, 'Always use UK English.')

    const systemMsg = capturedRequest!.messages.find(m => m.role === 'system')
    expect(typeof systemMsg?.content === 'string' && systemMsg.content).toContain('UK English')
  })
})
