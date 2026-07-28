import path from 'path'
import fs from 'fs/promises'
import type {
  ParseOptions,
  ParseResult,
  PageResult,
  ExtractedPage,
  ParseMode,
} from './types.js'
import { CostLimitError } from './types.js'
import { createLogger } from './utils/logger.js'
import { retry } from './utils/retry.js'
import { createPool } from './utils/concurrency.js'
import { parsePageRange } from './utils/pages.js'
import { getPdfPageCount, extractPdfPages, makeImagePage } from './extract/text.js'
import { renderPdfPages } from './extract/render.js'
import { extractDocxPages } from './extract/docx.js'
import { extractPptxPages } from './extract/pptx.js'
import { extractSpreadsheetPages } from './extract/xlsx.js'
import { extractPlaintextPage } from './extract/plaintext.js'
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
  const { buffer, filename, ext, kind, mimeType } = await resolveInput(input)
  logger.log(`Loaded "${filename}" (${buffer.length} bytes, kind=${kind})`)

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
  const maxPages = options.maxPages ?? Infinity
  const maxTokenBudget = options.maxTokenBudget ?? Infinity

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
  const isPdf = kind === 'pdf'

  if (isPdf) {
    const pageCount = await getPdfPageCount(buffer)
    logger.log(`PDF has ${pageCount} pages`)
    pageNumbers = options.pages
      ? parsePageRange(options.pages, pageCount)
      : Array.from({ length: pageCount }, (_, i) => i + 1)
  } else {
    pageNumbers = [1]
  }

  // Apply maxPages hard cap
  if (pageNumbers.length > maxPages) {
    logger.log(`maxPages=${maxPages} cap: trimming ${pageNumbers.length} → ${maxPages} pages`)
    pageNumbers = pageNumbers.slice(0, maxPages)
  }

  // Apply maxPages hard cap
  if (pageNumbers.length > maxPages) {
    logger.log(`maxPages=${maxPages} cap: trimming ${pageNumbers.length} → ${maxPages} pages`)
    pageNumbers = pageNumbers.slice(0, maxPages)
  }

  const totalPages = pageNumbers.length
  logger.log(`Processing ${totalPages} page(s) with mode="${mode}"`)

  // 4. Extract text for all requested pages (dispatcher by format kind)
  let extractedPages: ExtractedPage[]

  switch (kind) {
    case 'pdf':
      extractedPages = await extractPdfPages(buffer, pageNumbers, logger)
      break
    case 'docx':
      extractedPages = await extractDocxPages(buffer, logger)
      break
    case 'pptx':
      extractedPages = await extractPptxPages(buffer, logger)
      break
    case 'spreadsheet':
      extractedPages = await extractSpreadsheetPages(buffer, logger)
      break
    case 'csv':
      extractedPages = await extractSpreadsheetPages(buffer, logger, {
        delimiter: ext === '.tsv' ? '\t' : ',',
      })
      break
    case 'plaintext':
      extractedPages = await extractPlaintextPage(buffer, ext, logger)
      break
    case 'image':
      extractedPages = [makeImagePage(buffer, mimeType)]
      break
    default:
      extractedPages = await extractPdfPages(buffer, pageNumbers, logger)
  }

  // 5. Pre-render pages that need screenshots (PDF only, agentic/auto modes)
  const needsRendering = isPdf && (mode === 'agentic' || mode === 'auto')
  let renderedImages: Map<number, Buffer> = new Map()

  if (needsRendering) {
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
        const rendered = await renderPdfPages(buffer, agenticCandidates, dpi, logger)
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
  let tokensTotalUsed = 0
  let budgetExceeded = false

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

      const tokensUsed = (pageResult as { tokensUsed?: number }).tokensUsed ?? 0
      tokensTotalUsed += tokensUsed

      results.push({
        pageNumber: pageNum,
        markdown: pageResult.markdown,
        text: pageResult.text,
        modeUsed: actualMode,
        hasScreenshot: pageResult.hasScreenshot ?? false,
        tokensUsed: tokensUsed || undefined,
      })

      // Check token budget after each page
      if (tokensTotalUsed > maxTokenBudget) {
        budgetExceeded = true
      }
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

  await Promise.all(
    extractedPages.map(p =>
      pool(async () => {
        if (budgetExceeded) return
        await processPage(p)
      })
    )
  )

  // 7. Merge and return
  const durationMs = Date.now() - startMs
  logger.log(
    `Done in ${durationMs}ms — pages: ${results.length}, errors: ${errors.length}` +
      (budgetExceeded ? ` [token budget exceeded: ~${tokensTotalUsed} tokens]` : '')
  )

  const merged = mergeResults(results, errors, filename, model, resultType, durationMs)

  if (budgetExceeded) {
    throw new CostLimitError(tokensTotalUsed, maxTokenBudget, merged)
  }

  return merged
}

// ─── Input resolution ──────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.tif', '.heic', '.heif'])
const IMAGE_MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
}

const SPREADSHEET_EXTS = new Set(['.xlsx', '.xls', '.xlsm', '.ods', '.numbers'])
const CSV_EXTS = new Set(['.csv', '.tsv'])
const PLAINTEXT_EXTS = new Set(['.txt', '.md', '.markdown', '.rtf', '.html', '.htm'])

type BufferKind = 'pdf' | 'docx' | 'pptx' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Sniff magic bytes to identify buffer content without relying on a file extension. */
function sniffBuffer(buf: Buffer): BufferKind {
  if (buf.length < 4) return 'pdf'
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif'
  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf.length >= 12 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp'
  // ZIP-based formats: PK 03 04 (DOCX, PPTX, XLSX, ODS — distinguished by extension at call site)
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'docx'
  return 'pdf'
}

type FormatKind = 'pdf' | 'image' | 'docx' | 'pptx' | 'spreadsheet' | 'csv' | 'plaintext'

interface ResolvedInput {
  buffer: Buffer
  filename: string
  ext: string
  kind: FormatKind
  mimeType: string
}

function classifyExt(ext: string): FormatKind {
  if (ext === '.pdf') return 'pdf'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === '.docx' || ext === '.doc') return 'docx'
  if (ext === '.pptx' || ext === '.ppt') return 'pptx'
  if (SPREADSHEET_EXTS.has(ext)) return 'spreadsheet'
  if (CSV_EXTS.has(ext)) return 'csv'
  if (PLAINTEXT_EXTS.has(ext)) return 'plaintext'
  return 'pdf'
}

const SUPPORTED_EXTS = new Set([
  '.pdf',
  '.docx', '.doc',
  '.pptx', '.ppt',
  ...SPREADSHEET_EXTS,
  ...CSV_EXTS,
  ...IMAGE_EXTS,
  ...PLAINTEXT_EXTS,
])

async function resolveInput(input: string | Buffer | URL): Promise<ResolvedInput> {
  if (Buffer.isBuffer(input)) {
    const sniff = sniffBuffer(input)
    const isImage = sniff.startsWith('image/')
    const isZip = sniff === 'docx'
    const kind: FormatKind = isImage ? 'image' : isZip ? 'docx' : 'pdf'
    const ext = isImage ? `.${sniff.split('/')[1]}` : isZip ? '.docx' : '.pdf'
    return {
      buffer: input,
      filename: `document${ext}`,
      ext,
      kind,
      mimeType: isImage ? sniff : 'application/pdf',
    }
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
    const kind = classifyExt(ext)
    return {
      buffer: buf,
      filename: rawName,
      ext,
      kind,
      mimeType: IMAGE_MIMES[ext] ?? 'application/octet-stream',
    }
  }

  // Local file path
  const filePath = inputStr
  const buffer = await fs.readFile(filePath)
  const filename = path.basename(filePath)
  const ext = path.extname(filename).toLowerCase()

  if (!SUPPORTED_EXTS.has(ext)) {
    throw new Error(
      `Unsupported file type: "${ext}". ` +
        'Supported formats: PDF, DOCX, PPTX, XLSX/XLS/CSV/TSV, ' +
        'PNG/JPEG/WebP/GIF/BMP/TIFF/HEIC, HTML, TXT, MD, RTF.\n' +
        'EPUB support is planned for a future release.'
    )
  }

  return {
    buffer,
    filename,
    ext,
    kind: classifyExt(ext),
    mimeType: IMAGE_MIMES[ext] ?? 'application/octet-stream',
  }
}
