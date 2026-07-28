import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { parseStream } from '../src/index.js'

const FIXTURES = join(fileURLToPath(import.meta.url), '..', 'fixtures')

describe('parseStream', () => {
  it('is an async generator', async () => {
    const gen = parseStream(join(FIXTURES, 'simple.pdf'), { mode: 'fast' })
    expect(gen[Symbol.asyncIterator]).toBeTypeOf('function')
  })

  it('yields PageResult objects with required fields', async () => {
    const pages = []
    for await (const page of parseStream(join(FIXTURES, 'simple.pdf'), { mode: 'fast' })) {
      pages.push(page)
    }

    expect(pages.length).toBeGreaterThan(0)

    for (const page of pages) {
      expect(page).toHaveProperty('pageNumber')
      expect(page).toHaveProperty('markdown')
      expect(page).toHaveProperty('text')
      expect(page).toHaveProperty('modeUsed')
      expect(page).toHaveProperty('hasScreenshot')
      expect(typeof page.pageNumber).toBe('number')
      expect(typeof page.markdown).toBe('string')
    }
  })

  it('yields pages in page-number order', async () => {
    const pageNumbers: number[] = []
    for await (const page of parseStream(join(FIXTURES, 'simple.pdf'), { mode: 'fast' })) {
      pageNumbers.push(page.pageNumber)
    }
    const sorted = [...pageNumbers].sort((a, b) => a - b)
    expect(pageNumbers).toEqual(sorted)
  })

  it('respects maxPages option', async () => {
    const pages = []
    for await (const page of parseStream(join(FIXTURES, 'simple.pdf'), {
      mode: 'fast',
      maxPages: 1,
    })) {
      pages.push(page)
    }
    expect(pages.length).toBeLessThanOrEqual(1)
  })

  it('calls onProgress for each yielded page', async () => {
    const progresses: number[] = []
    for await (const _ of parseStream(join(FIXTURES, 'simple.pdf'), {
      mode: 'fast',
      onProgress: ({ percent }) => progresses.push(percent),
    })) {
      // drain generator
    }
    expect(progresses.length).toBeGreaterThan(0)
    expect(progresses[progresses.length - 1]).toBe(100)
  })

  it('works with Buffer input', async () => {
    const { readFile } = await import('fs/promises')
    const buf = await readFile(join(FIXTURES, 'simple.pdf'))
    const pages = []
    for await (const page of parseStream(buf, { mode: 'fast' })) {
      pages.push(page)
    }
    expect(pages.length).toBeGreaterThan(0)
  })

  it('fast mode yields markdown string', async () => {
    for await (const page of parseStream(join(FIXTURES, 'simple.pdf'), { mode: 'fast' })) {
      expect(typeof page.markdown).toBe('string')
      expect(page.modeUsed).toBe('fast')
    }
  })
})
