import path from 'path'
import fs from 'fs/promises'
import type {
  ParseOptions,
  ParseResult,
  PageResult,
  ExtractedPage,
  ParseMode,
} from './types.js'
import { createLogger } from './utils/logger.js'
import { retry } from './utils/retry.js'
import { createPool } from './utils/concurrency.js'
import { parsePageRange } from './utils/pages.js'
import { getPdfPageCount, extractPdfPages, makeImagePage } from './extract/text.js'
import { renderPdfPages } from './extract/render.js'
import { classifyPage } from './router.js'
import { processFast } from './modes/fast.js'
import { processCostEffective } from './modes/costEffective.js'
import { processAgentic } from './modes/agentic.js'
import { createLLMClient } from './llm/index.js'
import { mergeResults } from './merge.js'

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS = {
  concurrency: 3,
  dpi: 150,
  temperature: 0,
  maxRetries: 3,
  baseUrlOpenAI: 'https://api.openai.com/v1',
  baseUrlAnthropic: 'https://api.anthropic.com',
  modelCostEffective: 'gpt-4o-mini',
  modelAgentic: 'gpt-4o',
} as const

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a document file (PDF or image) into clean markdown/text/JSON.
 *
 * @param input - File path string, Buffer, or HTTP(S) URL string
 * @param options - Parsing options (model, mode, API key, …)
 */
export async function parse(
  input: string | Buffer | URL,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const startMs = Date.now()
  const logger = createLogger(options.debug ?? false)

  // 1. Resolve input to buffer + filename
  const { buffer, filename, isImage, mimeType } = await resolveInput(input)
  logger.log(`Loaded "${filename}" (${buffer.length} bytes, isImage=${isImage})`)

  // 2. Build config
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
  const resultType = options.resultType ?? 'markdown'
  const concurrency = options.concurrency ?? DEFAULTS.concurrency
  const dpi = options.dpi ?? DEFAULTS.dpi
  const temperature = options.temperature ?? DEFAULTS.temperature
  const maxRetries = options.maxRetries ?? DEFAULTS.maxRetries

  // Choose a sensible default model based on mode
  const defaultModel =
    mode === 'agentic' ? DEFAULTS.modelAgentic : DEFAULTS.modelCostEffective
  const model =
    options.model ?? process.env['OPENPARSE_MODEL'] ?? defaultModel

  if (!apiKey && mode !== 'fast') {
    throw new Error(
      'No API key provided. Set the apiKey option or OPENAI_API_KEY / ANTHROPIC_API_KEY environment variable.\n' +
      'Use mode: "fast" to parse without an LLM key (text-layer extraction only).'
    )
  }

  const llmClient = createLLMClient({ apiKey, baseUrl, provider })

  // 3. Enumerate pages
  let pageNumbers: number[]
  const pdfBuffer: Buffer | null = isImage ? null : buffer

  if (isImage) {
    pageNumbers = [1]
  } else {
    const pageCount = await getPdfPageCount(buffer)
    logger.log(`PDF has ${pageCount} pages`)
    pageNumbers = options.pages
      ? parsePageRange(options.pages, pageCount)
      : Array.from({ length: pageCount }, (_, i) => i + 1)
  }

  const totalPages = pageNumbers.length
  logger.log(`Processing ${totalPages} page(s) with mode="${mode}"`)

  // 4. Extract text layer for all requested pages
  let extractedPages: ExtractedPage[]

  if (isImage) {
    extractedPages = [makeImagePage(buffer, mimeType)]
  } else {
    extractedPages = await extractPdfPages(buffer, pageNumbers, logger)
  }

  // 5. Pre-render pages that will need screenshots (only in agentic/auto modes)
  const needsRendering = mode === 'agentic' || mode === 'auto'
  let renderedImages: Map<number, Buffer> = new Map()

  if (needsRendering && pdfBuffer) {
    // In auto mode, render only pages the router flags as agentic
    const agenticCandidates =
      mode === 'auto'
        ? extractedPages
            .filter(p => {
              const complexity = classifyPage(p)
              return complexity.suggestedMode === 'agentic'
            })
            .map(p => p.pageNumber)
        : pageNumbers

    if (agenticCandidates.length > 0) {
      logger.log(`Rendering ${agenticCandidates.length} page(s) for vision processing…`)
      try {
        const rendered = await renderPdfPages(pdfBuffer, agenticCandidates, dpi, logger)
        for (const [pageNum, renderedPage] of rendered) {
          renderedImages.set(pageNum, renderedPage.imageBuffer)
        }
      } catch (err) {
        logger.warn(
          'Page rendering failed — agentic mode will fall back to text-only:\n',
          (err as Error).message
        )
      }
    }
  }

  // 6. Process pages concurrently
  const pool = createPool(concurrency)
  const results: PageResult[] = []
  const errors: Array<{ pageNumber: number; error: string }> = []
  let pagesComplete = 0

  const processPage = async (extracted: ExtractedPage): Promise<void> => {
    const pageNum = extracted.pageNumber
    const forcedMode =
      mode !== 'auto' ? (mode as Exclude<ParseMode, 'auto'>) : undefined
    const complexity = classifyPage(extracted, forcedMode)
    const actualMode = complexity.suggestedMode

    logger.log(
      `Page ${pageNum}: mode=${actualMode}` +
        ` scan=${complexity.isLikelyScan}` +
        ` tables=${complexity.hasTablesDetected}` +
        ` multiCol=${complexity.isMultiColumn}`
    )

    let pageResult: Omit<PageResult, 'pageNumber' | 'modeUsed'> = {
      markdown: '',
      text: '',
      hasScreenshot: false,
    }

    try {
      await retry(
        async () => {
          switch (actualMode) {
            case 'fast': {
              const r = await processFast(extracted)
              pageResult = { ...r, hasScreenshot: false }
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
              pageResult = { ...r, hasScreenshot: false }
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
              pageResult = r
              break
            }
          }
        },
        { attempts: maxRetries, delayMs: 500 }
      )

      results.push({
        pageNumber: pageNum,
        markdown: pageResult.markdown,
        text: pageResult.text,
        modeUsed: actualMode,
        hasScreenshot: pageResult.hasScreenshot ?? false,
        tokensUsed: (pageResult as { tokensUsed?: number }).tokensUsed,
      })
    } catch (err) {
      const errMsg = (err as Error).message
      logger.error(`Page ${pageNum} failed after ${maxRetries} attempts: ${errMsg}`)
      errors.push({ pageNumber: pageNum, error: errMsg })

      results.push({
        pageNumber: pageNum,
        markdown: '',
        text: '',
        modeUsed: actualMode,
        hasScreenshot: false,
        error: errMsg,
      })
    }

    pagesComplete++

    options.onPageComplete?.({
      pageNumber: pageNum,
      totalPages,
      modeUsed: actualMode,
      hasScreenshot: results.find(r => r.pageNumber === pageNum)?.hasScreenshot ?? false,
    })

    options.onProgress?.({
      pagesComplete,
      totalPages,
      percent: Math.round((pagesComplete / totalPages) * 100),
    })
  }

  await Promise.all(extractedPages.map(p => pool(() => processPage(p))))

  // 7. Merge and return
  const durationMs = Date.now() - startMs
  logger.log(
    `Done in ${durationMs}ms — pages: ${results.length}, errors: ${errors.length}`
  )

  return mergeResults(results, errors, filename, model, resultType, durationMs)
}

// ─── Input resolution ──────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const IMAGE_MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

interface ResolvedInput {
  buffer: Buffer
  filename: string
  isImage: boolean
  mimeType: string
}

async function resolveInput(input: string | Buffer | URL): Promise<ResolvedInput> {
  if (Buffer.isBuffer(input)) {
    return { buffer: input, filename: 'document', isImage: false, mimeType: 'application/pdf' }
  }

  const inputStr = typeof input === 'string' ? input : input.href

  // HTTP(S) URL
  if (/^https?:\/\//i.test(inputStr)) {
    const res = await fetch(inputStr)
    if (!res.ok) {
      throw new Error(`Failed to fetch "${inputStr}": ${res.status} ${res.statusText}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const rawName = path.basename(inputStr.split('?')[0]) || 'document'
    const ext = path.extname(rawName).toLowerCase()
    const isImage = IMAGE_EXTS.has(ext)
    return {
      buffer: buf,
      filename: rawName,
      isImage,
      mimeType: IMAGE_MIMES[ext] ?? 'application/pdf',
    }
  }

  // Local file path
  const filePath = inputStr
  const buffer = await fs.readFile(filePath)
  const filename = path.basename(filePath)
  const ext = path.extname(filename).toLowerCase()
  const isImage = IMAGE_EXTS.has(ext)

  if (!isImage && ext !== '.pdf') {
    throw new Error(
      `Unsupported file type: "${ext}". ` +
        'Supported formats: PDF (.pdf), PNG (.png), JPEG (.jpg/.jpeg), WebP (.webp).\n' +
        'DOCX/PPTX support is planned for a future release.'
    )
  }

  return {
    buffer,
    filename,
    isImage,
    mimeType: IMAGE_MIMES[ext] ?? 'application/pdf',
  }
}
