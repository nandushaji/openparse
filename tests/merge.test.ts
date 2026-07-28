import { describe, it, expect } from 'vitest'
import { mergeResults } from '../src/merge.js'
import type { PageResult } from '../src/types.js'

function makePage(overrides: Partial<PageResult> & { pageNumber: number }): PageResult {
  const modeUsed = overrides.modeUsed ?? overrides.mode ?? 'fast'
  return {
    markdown: '',
    text: '',
    mode: modeUsed,
    modeUsed,
    hasScreenshot: false,
    ...overrides,
  }
}

describe('mergeResults', () => {
  it('sorts pages by number regardless of processing order', () => {
    const pages = [
      makePage({ pageNumber: 3, markdown: 'Page 3', text: 'Page 3' }),
      makePage({ pageNumber: 1, markdown: 'Page 1', text: 'Page 1' }),
      makePage({ pageNumber: 2, markdown: 'Page 2', text: 'Page 2' }),
    ]

    const result = mergeResults(pages, [], 'test.pdf', 'gpt-4o-mini', 'markdown', 100)

    const mdPages = result.markdown.split('---').map(s => s.trim()).filter(Boolean)
    expect(mdPages[0]).toBe('Page 1')
    expect(mdPages[1]).toBe('Page 2')
    expect(mdPages[2]).toBe('Page 3')
  })

  it('populates usage stats correctly', () => {
    const pages = [
      makePage({ pageNumber: 1, mode: 'fast', modeUsed: 'fast' }),
      makePage({ pageNumber: 2, mode: 'cost_effective', modeUsed: 'cost_effective', tokensUsed: 100 }),
      makePage({ pageNumber: 3, mode: 'agentic', modeUsed: 'agentic', tokensUsed: 300 }),
    ]

    const result = mergeResults(pages, [], 'test.pdf', 'gpt-4o-mini', 'markdown', 500)

    expect(result.usage.totalPages).toBe(3)
    expect(result.usage.pagesByMode['fast']).toBe(1)
    expect(result.usage.pagesByMode['cost_effective']).toBe(1)
    expect(result.usage.pagesByMode['agentic']).toBe(1)
    expect(result.usage.estimatedTokens).toBe(400)
    expect(result.usage.durationMs).toBe(500)
  })

  it('includes errors in result', () => {
    const pages = [makePage({ pageNumber: 1, markdown: 'ok', text: 'ok' })]
    const errors = [{ pageNumber: 2, error: 'Render failed' }]

    const result = mergeResults(pages, errors, 'test.pdf', 'gpt-4o-mini', 'markdown', 100)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].pageNumber).toBe(2)
  })

  it('extracts structured items when resultType is json and LLM was used', () => {
    // items require at least one LLM-processed (non-fast) page
    const pages = [
      makePage({
        pageNumber: 1,
        mode: 'cost_effective',
        modeUsed: 'cost_effective',
        markdown:
          '# Main Heading\n\n## Sub Heading\n\nA paragraph here.\n\n| Col A | Col B |\n|-------|-------|\n| 1 | 2 |',
        text: 'some text',
      }),
    ]

    const result = mergeResults(pages, [], 'test.pdf', 'gpt-4o-mini', 'json', 100)

    expect(result.items).toBeDefined()
    expect(result.items!.headings).toHaveLength(2)
    expect(result.items!.headings[0]).toMatchObject({ level: 1, text: 'Main Heading', pageNumber: 1 })
    expect(result.items!.headings[1]).toMatchObject({ level: 2, text: 'Sub Heading', pageNumber: 1 })
    expect(result.items!.tables).toHaveLength(1)
    expect(result.items!.tables[0].markdown).toContain('Col A')
  })

  it('does not extract items in fast-only runs even with resultType json', () => {
    // All fast — no LLM markdown structure, so items would always be empty anyway
    const pages = [makePage({ pageNumber: 1, markdown: 'plain text here', text: 'plain text here' })]
    const result = mergeResults(pages, [], 'test.pdf', 'gpt-4o-mini', 'json', 100)
    expect(result.items).toBeUndefined()
  })

  it('does not extract items when resultType is markdown', () => {
    const pages = [makePage({ pageNumber: 1, mode: 'cost_effective', modeUsed: 'cost_effective', markdown: '# Heading', text: 'Heading' })]
    const result = mergeResults(pages, [], 'test.pdf', 'gpt-4o-mini', 'markdown', 100)
    expect(result.items).toBeUndefined()
  })

  it('sets model to string when LLM was used', () => {
    const pages = [makePage({ pageNumber: 1, mode: 'cost_effective', modeUsed: 'cost_effective' })]
    const result = mergeResults(pages, [], 'report.pdf', 'gpt-4o', 'markdown', 1234)

    expect(result.metadata.filename).toBe('report.pdf')
    expect(result.metadata.model).toBe('gpt-4o')
    expect(result.metadata.durationMs).toBe(1234)
    expect(result.metadata.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('sets model to null in fast-only runs', () => {
    const pages = [makePage({ pageNumber: 1 })]
    const result = mergeResults(pages, [], 'report.pdf', 'gpt-4o', 'markdown', 1234)
    expect(result.metadata.model).toBeNull()
  })
})
