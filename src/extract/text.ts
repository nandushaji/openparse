import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import type { ExtractedPage, TextPosition } from '../types.js'
import type { Logger } from '../utils/logger.js'

// ─── pdfjs worker setup ────────────────────────────────────────────────────────
// Runs once per process. Uses createRequire so it works in both ESM and CJS builds.
let pdfjsLib: typeof import('pdfjs-dist') | null = null

async function getPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsLib) return pdfjsLib

  // pdfjs-dist v4 emits "Please use the legacy build in Node.js environments."
  // via console.warn on every load in Node.js. Our server-side usage is well-tested
  // and intentional — suppress only this specific advisory message.
  const origWarn = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('legacy build')) return
    origWarn(...args)
  }

  let lib: typeof import('pdfjs-dist')
  try {
    lib = await import('pdfjs-dist')
  } finally {
    console.warn = origWarn
  }

  pdfjsLib = lib

  try {
    const req = createRequire(import.meta.url)
    const workerPath = req.resolve('pdfjs-dist/build/pdf.worker.mjs')
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  } catch {
    // Fallback: empty string triggers pdfjs FakeWorker (main-thread, synchronous)
    lib.GlobalWorkerOptions.workerSrc = ''
  }

  return lib
}

// ─── Public functions ──────────────────────────────────────────────────────────

/** Returns the number of pages in a PDF buffer. */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const pdfjs = await getPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 })
  const doc = await task.promise
  const count = doc.numPages
  await doc.destroy()
  return count
}

/**
 * Extracts text content (with per-item positions) for the requested pages.
 * Pages that fail are returned with empty text rather than throwing.
 */
export async function extractPdfPages(
  buffer: Buffer,
  pageNumbers: number[],
  logger: Logger
): Promise<ExtractedPage[]> {
  const pdfjs = await getPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 })
  const doc = await task.promise

  const results: ExtractedPage[] = []

  for (const pageNum of pageNumbers) {
    if (pageNum < 1 || pageNum > doc.numPages) continue

    try {
      const page = await doc.getPage(pageNum)
      const viewport = page.getViewport({ scale: 1.0 })
      const textContent = await page.getTextContent()

      const positions: TextPosition[] = []
      for (const item of textContent.items) {
        if ('str' in item && item.str) {
          const tf = item.transform as number[]
          positions.push({
            str: item.str,
            x: tf[4] ?? 0,
            y: tf[5] ?? 0,
            width: item.width ?? 0,
            height: item.height ?? 0,
          })
        }
      }

      const text = positions
        .map(p => p.str)
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim()

      results.push({
        pageNumber: pageNum,
        text,
        wordCount: text ? text.split(/\s+/).filter(Boolean).length : 0,
        charCount: text.length,
        hasPositionData: true,
        positions,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
      })

      page.cleanup()
    } catch (err) {
      logger.warn(`Failed to extract text from page ${pageNum}:`, (err as Error).message)
      results.push({
        pageNumber: pageNum,
        text: '',
        wordCount: 0,
        charCount: 0,
        hasPositionData: false,
      })
    }
  }

  await doc.destroy()
  return results
}

/** Build an ExtractedPage from a raw image buffer (PNG/JPEG/WebP). */
export function makeImagePage(buffer: Buffer, mimeType: string): ExtractedPage {
  return {
    pageNumber: 1,
    text: '',
    wordCount: 0,
    charCount: 0,
    hasPositionData: false,
    // Store mime type hint in a stable way
    _imageMime: mimeType,
    _imageBuffer: buffer,
  } as ExtractedPage & { _imageMime: string; _imageBuffer: Buffer }
}
