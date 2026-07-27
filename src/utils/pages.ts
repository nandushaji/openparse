/**
 * Parse a page range string like '1-5,8,10-12' into a sorted, deduplicated
 * array of 1-indexed page numbers clamped to [1, maxPages].
 */
export function parsePageRange(rangeStr: string, maxPages: number): number[] {
  const pages = new Set<number>()

  for (const part of rangeStr.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const segments = trimmed.split('-').map(s => parseInt(s.trim(), 10))

    if (segments.length === 1) {
      const p = segments[0]
      if (!isNaN(p) && p >= 1 && p <= maxPages) pages.add(p)
    } else if (segments.length === 2) {
      const [start, end] = segments
      if (!isNaN(start) && !isNaN(end)) {
        for (let p = Math.max(1, start); p <= Math.min(maxPages, end); p++) {
          pages.add(p)
        }
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b)
}
