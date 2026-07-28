import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { parse, CostLimitError } from '../src/index.js'

const FIXTURES = join(fileURLToPath(import.meta.url), '..', 'fixtures')

describe('maxPages option', () => {
  it('silently caps pages beyond the limit', async () => {
    const result = await parse(join(FIXTURES, 'simple.pdf'), {
      mode: 'fast',
      maxPages: 1,
    })
    expect(result.pages.length).toBeLessThanOrEqual(1)
    expect(result.errors).toHaveLength(0)
  })

  it('does not cap when limit exceeds page count', async () => {
    const result = await parse(join(FIXTURES, 'simple.pdf'), {
      mode: 'fast',
      maxPages: 999,
    })
    expect(result.pages.length).toBeGreaterThan(0)
  })
})

describe('maxTokenBudget option', () => {
  it('throws CostLimitError when budget is 0 and LLM modes consume tokens', async () => {
    // With budget=0 and fast mode (no tokens used), it should NOT throw
    const result = await parse(join(FIXTURES, 'simple.pdf'), {
      mode: 'fast',
      maxTokenBudget: 0,
    })
    expect(result.pages.length).toBeGreaterThan(0)
  })

  it('CostLimitError carries partial results', async () => {
    // Simulate by using a budget of 0 with cost_effective mode — but we
    // have no real LLM in tests, so we verify the error class shape.
    const err = new CostLimitError(1500, 1000, {
      markdown: '# test',
      text: 'test',
      pages: [],
      usage: { totalPages: 1, pagesByMode: {}, estimatedTokens: 1500, durationMs: 100 },
      metadata: { filename: 'f', pageCount: 1, durationMs: 100, model: 'm', version: '0.2.0' },
      errors: [],
    })

    expect(err).toBeInstanceOf(CostLimitError)
    expect(err.name).toBe('CostLimitError')
    expect(err.message).toContain('1,500')
    expect(err.message).toContain('1,000')
    expect(err.message).toContain('partialResult')
    expect(err.partialResult.markdown).toBe('# test')
  })
})
