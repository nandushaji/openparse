import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import type { Logger } from '../utils/logger.js'

const RENDER_ERROR_MSG =
  'PDF page rendering requires the "canvas" package.\n' +
  '  Install it with: npm install canvas\n' +
  '  Note: canvas requires a native build toolchain (node-gyp).\n' +
  '  See https://github.com/Automattic/node-canvas#installation for platform instructions.\n' +
  '\n' +
  '  Alternatively, pass image files (PNG/JPEG) directly to parse() as input\n' +
  '  to use agentic mode without rendering.'

export interface RenderedPage {
  pageNumber: number
  imageBuffer: Buffer
  width: number
  height: number
}

/**
 * Renders the requested PDF pages to PNG buffers using pdfjs-dist + canvas.
 * Throws a helpful error if canvas is not installed.
 */
export async function renderPdfPages(
  pdfBuffer: Buffer,
  pageNumbers: number[],
  dpi: number,
  logger: Logger
): Promise<Map<number, RenderedPage>> {
  // Lazy-load canvas; fail gracefully if not installed
  let createCanvas: ((w: number, h: number) => unknown) | null = null
  try {
    const canvasModule = await import('canvas')
    createCanvas = canvasModule.createCanvas as (w: number, h: number) => unknown
  } catch {
    throw new Error(RENDER_ERROR_MSG)
  }

  const pdfjs = await import('pdfjs-dist')

  // Configure worker (mirrors text.ts setup)
  try {
    const req = createRequire(import.meta.url)
    const workerPath = req.resolve('pdfjs-dist/build/pdf.worker.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  } catch {
    pdfjs.GlobalWorkerOptions.workerSrc = ''
  }

  const scale = dpi / 72 // PDF user units are 1/72 inch

  // Build a NodeCanvasFactory for pdfjs
  const canvasFactory = makeNodeCanvasFactory(createCanvas as (w: number, h: number) => CanvasLike)

  const task = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    verbosity: 0,
    canvasFactory,
  } as Parameters<typeof pdfjs.getDocument>[0])

  const doc = await task.promise
  const results = new Map<number, RenderedPage>()

  for (const pageNum of pageNumbers) {
    if (pageNum < 1 || pageNum > doc.numPages) continue

    try {
      const page = await doc.getPage(pageNum)
      const viewport = page.getViewport({ scale })
      const width = Math.ceil(viewport.width)
      const height = Math.ceil(viewport.height)

      const canvasData = canvasFactory.create(width, height)

      await page.render({
        canvasContext: canvasData.context as unknown as object,
        viewport,
      }).promise

      const imageBuffer = (canvasData.canvas as CanvasLike).toBuffer('image/png')
      results.set(pageNum, { pageNumber: pageNum, imageBuffer, width, height })

      page.cleanup()
      canvasFactory.destroy(canvasData)

      logger.log(`Rendered page ${pageNum}: ${width}×${height} @ ${dpi} DPI`)
    } catch (err) {
      logger.warn(`Could not render page ${pageNum}:`, (err as Error).message)
    }
  }

  await doc.destroy()
  return results
}

// ─── NodeCanvasFactory ─────────────────────────────────────────────────────────

interface CanvasLike {
  width: number
  height: number
  getContext(type: '2d'): unknown
  toBuffer(type: string): Buffer
}

interface CanvasData {
  canvas: CanvasLike
  context: unknown
}

function makeNodeCanvasFactory(createCanvas: (w: number, h: number) => CanvasLike) {
  return {
    create(width: number, height: number): CanvasData {
      const canvas = createCanvas(width, height)
      return { canvas, context: canvas.getContext('2d') }
    },
    reset(data: CanvasData, width: number, height: number): void {
      data.canvas.width = width
      data.canvas.height = height
    },
    destroy(data: CanvasData): void {
      data.canvas.width = 0
      data.canvas.height = 0
    },
  }
}
