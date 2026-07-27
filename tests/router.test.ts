import { describe, it, expect } from 'vitest'
import { classifyPage } from '../src/router.js'
import type { ExtractedPage } from '../src/types.js'

function makePage(overrides: Partial<ExtractedPage> & { pageNumber: number }): ExtractedPage {
  const text = overrides.text ?? ''
  const words = text.split(/\s+/).filter(Boolean)
  return {
    text,
    wordCount: words.length,
    charCount: text.length,
    hasPositionData: false,
    ...overrides,
  }
}

describe('classifyPage', () => {
  it('routes an empty page as scan → agentic', () => {
    const page = makePage({ pageNumber: 1, text: '' })
    const result = classifyPage(page)
    expect(result.isLikelyScan).toBe(true)
    expect(result.suggestedMode).toBe('agentic')
  })

  it('routes dense text → fast', () => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(15)
    const page = makePage({ pageNumber: 1, text })
    const result = classifyPage(page)
    expect(result.isLikelyScan).toBe(false)
    expect(result.suggestedMode).toBe('fast')
  })

  it('detects pipe-heavy content as table → cost_effective', () => {
    const table =
      '| Name | Value | Notes |\n|------|-------|-------|\n| Foo | 42 | bar |\n' +
      '| Baz | 99 | qux |\n'
    const page = makePage({ pageNumber: 1, text: table + 'Some surrounding text here and there. ' })
    const result = classifyPage(page)
    expect(result.hasTablesDetected).toBe(true)
    expect(result.suggestedMode).toBe('cost_effective')
  })

  it('respects a forced mode override', () => {
    const page = makePage({ pageNumber: 1, text: '' })
    const result = classifyPage(page, 'fast')
    expect(result.suggestedMode).toBe('fast')
    expect(result.isLikelyScan).toBe(false)
  })

  it('detects multi-column layout from position data', () => {
    // Simulate two columns: items split between x=50 and x=350
    const positions = [
      ...Array.from({ length: 20 }, (_, i) => ({ str: `word${i}`, x: 50, y: 700 - i * 30, width: 5, height: 12 })),
      ...Array.from({ length: 20 }, (_, i) => ({ str: `word${i + 20}`, x: 350, y: 700 - i * 30, width: 5, height: 12 })),
    ]
    const text = positions.map(p => p.str).join(' ')
    const page = makePage({ pageNumber: 1, text, hasPositionData: true, positions })
    const result = classifyPage(page)
    expect(result.isMultiColumn).toBe(true)
    expect(result.suggestedMode).toBe('cost_effective')
  })

  it('provides textDensity between 0 and 1', () => {
    const page = makePage({ pageNumber: 1, text: 'hello world' })
    const result = classifyPage(page)
    expect(result.textDensity).toBeGreaterThanOrEqual(0)
    expect(result.textDensity).toBeLessThanOrEqual(1)
  })
})
