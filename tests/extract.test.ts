import { describe, it, expect } from 'vitest'
import { parsePageRange } from '../src/utils/pages.js'
import { bufferToDataUrl } from '../src/utils/base64.js'
import { retry } from '../src/utils/retry.js'
import { createPool } from '../src/utils/concurrency.js'

describe('parsePageRange', () => {
  it('parses a single page', () => {
    expect(parsePageRange('3', 10)).toEqual([3])
  })

  it('parses a closed range', () => {
    expect(parsePageRange('1-3', 10)).toEqual([1, 2, 3])
  })

  it('parses comma-separated pages', () => {
    expect(parsePageRange('1,3,5', 10)).toEqual([1, 3, 5])
  })

  it('parses a mixed range string', () => {
    expect(parsePageRange('1-3,5,8-10', 10)).toEqual([1, 2, 3, 5, 8, 9, 10])
  })

  it('clamps to maxPages', () => {
    expect(parsePageRange('8-15', 10)).toEqual([8, 9, 10])
  })

  it('deduplicates overlapping ranges', () => {
    expect(parsePageRange('1,1,2-3,2', 5)).toEqual([1, 2, 3])
  })

  it('ignores pages below 1', () => {
    expect(parsePageRange('0,1,2', 5)).toEqual([1, 2])
  })

  it('returns empty array for empty string', () => {
    expect(parsePageRange('', 10)).toEqual([])
  })
})

describe('bufferToDataUrl', () => {
  it('creates a valid data URL', () => {
    const buf = Buffer.from('hello')
    const url = bufferToDataUrl(buf, 'image/png')
    expect(url).toMatch(/^data:image\/png;base64,/)
    expect(url).toContain(buf.toString('base64'))
  })
})

describe('retry', () => {
  it('returns result on first success', async () => {
    const result = await retry(async () => 42)
    expect(result).toBe(42)
  })

  it('retries on failure and eventually succeeds', async () => {
    let calls = 0
    const result = await retry(
      async () => {
        calls++
        if (calls < 3) throw new Error('transient')
        return 'ok'
      },
      { attempts: 3, delayMs: 1 }
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('throws after exhausting all attempts', async () => {
    await expect(
      retry(async () => { throw new Error('permanent') }, { attempts: 2, delayMs: 1 })
    ).rejects.toThrow('permanent')
  })
})

describe('createPool', () => {
  it('limits concurrency', async () => {
    const pool = createPool(2)
    let active = 0
    let maxActive = 0

    const tasks = Array.from({ length: 5 }, () =>
      pool(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise(r => setTimeout(r, 10))
        active--
      })
    )

    await Promise.all(tasks)
    expect(maxActive).toBeLessThanOrEqual(2)
  })
})
