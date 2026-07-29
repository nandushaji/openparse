/**
 * parseStream — streaming variant of parse().
 *
 * Yields each PageResult as soon as it finishes processing, allowing callers
 * to start consuming output before the full document is complete.
 *
 * Concurrency is controlled by options.concurrency exactly as in parse().
 * Results are yielded in page order (not completion order) so downstream
 * code can append output sequentially without extra sorting.
 *
 * Usage:
 *   for await (const page of parseStream('/path/to/file.pdf', opts)) {
 *     console.log(page.pageNumber, page.markdown)
 *   }
 */

import path from 'path'
import fs from 'fs/promises'
import type {
  ParseOptions,
  PageResult,
  ExtractedPage,
  ParseMode,
  LLMClient,
} from './types.js'
import { createLogger } from './utils/logger.js'
import { retry } from './utils/retry.js'
import { createPool } from './utils/concurrency.js'
import { parsePageRange } from './utils/pages.js'
import { getPdfPageCount, extractPdfPages, makeImagePage } from './extract/text.js'
import { renderPdfPages } from './extract/render.js'
import { extractDocxPages } from './extract/docx.js'
import { classifyPage } from './router.js'
import { processFast } from './modes/fast.js'
import { processCostEffective } from './modes/costEffective.js'
import { processAgentic } from './modes/agentic.js'
import { createLLMClient } from './llm/index.js'

// ─── Re-use the same defaults and resolver from parse.ts ─────────────────────

const DEFAULTS = {
  concurrency: 3,
  dpi: 150,
  temperature: 0,
  maxRetries: 3,
  modelCostEffective: 'gpt-4o-mini',
  modelAgentic: 'gpt-4o',
  baseUrlOpenAI: 'https://api.openai.com/v1',
  baseUrlAnthropic: 'https://api.anthropic.com',
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif'])
const IMAGE_MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function* parseStream(
  input: string | Buffer | URL,
  options: ParseOptions = {}
): AsyncGenerator<PageResult, void, undefined> {
  const logger = createLogger(options.debug ?? false)

  // ── 1. Resolve input ───────────────────────────────────────────────────────
  const { buffer, filename, isImage, isDocx, mimeType } = await resolveInputForStream(input)
  logger.log(`[stream] Loaded "${filename}" (${buffer.length} bytes)`)

  // ── 2. Build config ────────────────────────────────────────────────────────
  const provider = options.provider ?? 'openai'
  const baseUrl =
    options.baseUrl ??
    (provider === 'anthropic' ? DEFAULTS.baseUrlAnthropic : DEFAULTS.baseUrlOpenAI)
  const apiKey =
    options.apiKey ??
    (provider === 'anthropic'
      ? process.env['ANTHROPIC_API_KEY'] ?? ''
      : process.env['OPENAI_API_KEY'] ?? '')

  const mode: ParseMode = options.mode ?? 'auto'
  const concurrency = options.concurrency ?? DEFAULTS.concurrency
  const dpi = options.dpi ?? DEFAULTS.dpi
  const temperature = options.temperature ?? DEFAULTS.temperature
  const maxRetries = options.maxRetries ?? DEFAULTS.maxRetries
  const maxPages = options.maxPages ?? Infinity

  const defaultModel =
    mode === 'agentic' ? DEFAULTS.modelAgentic : DEFAULTS.modelCostEffective
  const model = options.model ?? process.env['OPENPARSE_MODEL'] ?? defaultModel

  if (!options.client && !apiKey && mode !== 'fast') {
    throw new Error(
      'No API key provided. Set the apiKey option, pass a client, or set OPENAI_API_KEY / ANTHROPIC_API_KEY.\n' +
        'Use mode: "fast" to parse without an LLM key.'
    )
  }

  const llmClient: LLMClient =
    options.client ??
    (mode === 'fast'
      ? { chat: async () => { throw new Error('Internal: LLM client invoked in fast mode') } }
      : createLLMClient({ apiKey, baseUrl, provider }))

  // ── 3. Enumerate pages ─────────────────────────────────────────────────────
  let pageNumbers: number[]

  if (isImage || isDocx) {
    pageNumbers = [1]
  } else {
    const pageCount = await getPdfPageCount(buffer)
    logger.log(`[stream] PDF has ${pageCount} pages`)
    pageNumbers = options.pages
      ? parsePageRange(options.pages, pageCount)
      : Array.from({ length: pageCount }, (_, i) => i + 1)
  }

  if (pageNumbers.length > maxPages) {
    pageNumbers = pageNumbers.slice(0, maxPages)
  }

  logger.log(`[stream] Processing ${pageNumbers.length} page(s) with mode="${mode}"`)

  // ── 4. Extract text layer ──────────────────────────────────────────────────
  let extractedPages: ExtractedPage[]

  if (isDocx) {
    extractedPages = await extractDocxPages(buffer, logger)
  } else if (isImage) {
    extractedPages = [makeImagePage(buffer, mimeType)]
  } else {
    extractedPages = await extractPdfPages(buffer, pageNumbers, logger)
  }

  // ── 5. Pre-render pages needed for vision ─────────────────────────────────
  const needsRendering = !isDocx && !isImage && (mode === 'agentic' || mode === 'auto')
  let renderedImages: Map<number, Buffer> = new Map()

  if (needsRendering) {
    const agenticCandidates =
      mode === 'auto'
        ? extractedPages
            .filter(p => classifyPage(p).suggestedMode === 'agentic')
            .map(p => p.pageNumber)
        : pageNumbers

    if (agenticCandidates.length > 0) {
      logger.log(`[stream] Rendering ${agenticCandidates.length} page(s) for vision…`)
      try {
        const rendered = await renderPdfPages(buffer, agenticCandidates, dpi, logger)
        for (const [pageNum, rp] of rendered) {
          renderedImages.set(pageNum, rp.imageBuffer)
        }
      } catch (err) {
        logger.log(`[stream] Render warning: ${String(err)}`)
      }
    }
  }

  // ── 6. Build one promise per page (pool controls concurrency) ─────────────
  const pool = createPool(concurrency)
  let pagesComplete = 0
  const totalPages = extractedPages.length

  const processPage = (extracted: ExtractedPage): Promise<PageResult> => {
    const pageNum = extracted.pageNumber
    const forcedMode =
      mode !== 'auto' ? (mode as Exclude<ParseMode, 'auto'>) : undefined
    const complexity = classifyPage(extracted, forcedMode)
    const actualMode = complexity.suggestedMode

    logger.log(`[stream] Page ${pageNum}: mode=${actualMode}`)

    return retry(
      async () => {
        let partialResult: Omit<PageResult, 'pageNumber' | 'mode' | 'modeUsed'> = {
          markdown: '',
          text: '',
          hasScreenshot: false,
        }

        switch (actualMode) {
          case 'fast': {
            const r = await processFast(extracted)
            partialResult = { ...r, hasScreenshot: false }
            break
          }
          case 'cost_effective': {
            const r = await processCostEffective(
              extracted,
              llmClient,
              model,
              temperature,
              options.instructions
            )
            partialResult = { ...r, hasScreenshot: false }
            break
          }
          case 'agentic': {
            const imgBuf = renderedImages.get(pageNum) ?? null
            const r = await processAgentic(
              extracted,
              imgBuf,
              llmClient,
              model,
              temperature,
              logger,
              options.instructions
            )
            partialResult = r
            break
          }
        }

        pagesComplete++
        const result: PageResult = {
          pageNumber: pageNum,
          markdown: partialResult.markdown,
          text: partialResult.text,
          mode: actualMode,
          modeUsed: actualMode,
          hasScreenshot: partialResult.hasScreenshot ?? false,
          tokensUsed: (partialResult as { tokensUsed?: number }).tokensUsed,
        }

        options.onPageComplete?.({
          pageNumber: pageNum,
          totalPages,
          modeUsed: actualMode,
          hasScreenshot: result.hasScreenshot,
        })

        options.onProgress?.({
          pagesComplete,
          totalPages,
          percent: Math.round((pagesComplete / totalPages) * 100),
        })

        return result
      },
      { attempts: maxRetries, delayMs: 500 }
    )
  }

  // Kick off all page tasks through the pool immediately.
  // Store promises in page order so we can yield sequentially.
  const pendingPages = extractedPages.map(p => pool(() => processPage(p)))

  // Yield results in page order as each settles.
  for (const pending of pendingPages) {
    yield await pending
  }
}

// ─── Input resolution (minimal version for stream — no new format routing) ───

interface StreamResolvedInput {
  buffer: Buffer
  filename: string
  isImage: boolean
  isDocx: boolean
  mimeType: string
}

async function resolveInputForStream(
  input: string | Buffer | URL
): Promise<StreamResolvedInput> {
  if (Buffer.isBuffer(input)) {
    // Simple magic-byte sniff
    const b = input
    const isJpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    const isGif = b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38
    const isWebp =
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
    const isZip = b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
    const isImage = isJpeg || isPng || isGif || isWebp
    const mime = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : isGif ? 'image/gif' : isWebp ? 'image/webp' : 'application/pdf'
    return {
      buffer: input,
      filename: isImage ? `document.${mime.split('/')[1]}` : isZip ? 'document.docx' : 'document.pdf',
      isImage,
      isDocx: isZip && !isImage,
      mimeType: mime,
    }
  }

  const inputStr = typeof input === 'string' ? input : input.href

  if (/^https?:\/\//i.test(inputStr)) {
    const res = await fetch(inputStr)
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const name = path.basename(inputStr.split('?')[0]) || 'document'
    const ext = path.extname(name).toLowerCase()
    const isImage = IMAGE_EXTS.has(ext)
    return {
      buffer: buf,
      filename: name,
      isImage,
      isDocx: ext === '.docx',
      mimeType: IMAGE_MIMES[ext] ?? 'application/pdf',
    }
  }

  const buf = await fs.readFile(inputStr)
  const name = path.basename(inputStr)
  const ext = path.extname(name).toLowerCase()
  const isImage = IMAGE_EXTS.has(ext)
  return {
    buffer: buf,
    filename: name,
    isImage,
    isDocx: ext === '.docx',
    mimeType: IMAGE_MIMES[ext] ?? 'application/pdf',
  }
}
