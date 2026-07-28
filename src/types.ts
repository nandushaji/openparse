// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * Thrown when cumulative estimated LLM token usage reaches `maxTokenBudget`.
 * Inspect `result` to access pages that completed before the limit was hit.
 */
export class CostLimitError extends Error {
  readonly partialResult: Omit<ParseResult, 'items'>

  constructor(tokensUsed: number, budget: number, partialResult: Omit<ParseResult, 'items'>) {
    super(
      `Token budget exceeded: used ~${tokensUsed.toLocaleString()} tokens against a ` +
        `limit of ${budget.toLocaleString()}. ` +
        `Access partial results via error.partialResult.`
    )
    this.name = 'CostLimitError'
    this.partialResult = partialResult
  }
}

// ─── Public API types ─────────────────────────────────────────────────────────

export type ParseMode = 'fast' | 'cost_effective' | 'agentic' | 'auto'
export type ResultType = 'markdown' | 'text' | 'json'
export type LLMProvider = 'openai' | 'anthropic' | 'compatible'

export interface ParseOptions {
  /** LLM API key. Falls back to OPENAI_API_KEY or ANTHROPIC_API_KEY env vars. */
  apiKey?: string
  /** LLM model name (default: gpt-4o-mini for cost_effective, gpt-4o for agentic) */
  model?: string
  /** Base URL for the LLM API (default: OpenAI). Override for Ollama, Groq, Azure, etc. */
  baseUrl?: string
  /** Provider format. Use 'anthropic' for Anthropic API; 'compatible' for custom OpenAI-compat endpoints. */
  provider?: LLMProvider
  /** Parsing mode (default: 'auto') */
  mode?: ParseMode
  /** Output format (default: 'markdown') */
  resultType?: ResultType
  /** Custom instructions passed to the LLM for all pages */
  instructions?: string
  /** Page range to process, e.g. '1-5,8,10-12' (1-indexed, PDF only) */
  pages?: string
  /** Maximum concurrent page LLM requests (default: 3) */
  concurrency?: number
  /** LLM temperature — keep at 0 for deterministic output (default: 0) */
  temperature?: number
  /** Maximum LLM call retry attempts per page on transient errors (default: 3) */
  maxRetries?: number
  /** Render DPI for PDF page images in agentic mode (default: 150) */
  dpi?: number
  /** Hard cap on pages processed — pages beyond this are silently dropped (default: unlimited) */
  maxPages?: number
  /**
   * Soft cap on estimated LLM input tokens across all pages.
   * When the running total reaches this limit processing stops and a
   * `CostLimitError` is thrown. Pages already completed are preserved. (default: unlimited)
   */
  maxTokenBudget?: number
  /** Enable debug logging to stderr */
  debug?: boolean
  /** Called after each page completes */
  onPageComplete?: (info: PageCompleteInfo) => void
  /** Called after each page completes (alias for onPageComplete with progress fields) */
  onProgress?: (info: ProgressInfo) => void
}

export interface PageCompleteInfo {
  pageNumber: number
  totalPages: number
  modeUsed: Exclude<ParseMode, 'auto'>
  hasScreenshot: boolean
}

export interface ProgressInfo {
  pagesComplete: number
  totalPages: number
  percent: number
}

export interface PageResult {
  pageNumber: number
  markdown: string
  text: string
  modeUsed: Exclude<ParseMode, 'auto'>
  hasScreenshot: boolean
  tokensUsed?: number
  error?: string
}

export interface ParseResultItems {
  headings: Array<{ level: number; text: string; pageNumber: number }>
  tables: Array<{ markdown: string; pageNumber: number }>
  paragraphs: Array<{ text: string; pageNumber: number }>
}

export interface UsageInfo {
  totalPages: number
  pagesByMode: Record<string, number>
  estimatedTokens: number
  durationMs: number
}

export interface ParseResult {
  /** Full document as markdown (pages joined with --- separators) */
  markdown: string
  /** Full document as plain text */
  text: string
  /** Per-page results in page order */
  pages: PageResult[]
  /** Structured extraction — populated only when resultType is 'json' */
  items?: ParseResultItems
  usage: UsageInfo
  metadata: {
    filename: string
    pageCount: number
    durationMs: number
    model: string
    /** Library version */
    version: string
  }
  /** Pages that failed — other pages still succeed */
  errors: Array<{ pageNumber: number; error: string }>
}

// ─── Internal types ────────────────────────────────────────────────────────────

export interface ExtractedPage {
  pageNumber: number
  text: string
  wordCount: number
  charCount: number
  hasPositionData: boolean
  positions?: TextPosition[]
  pageWidth?: number
  pageHeight?: number
  /**
   * Pre-converted markdown produced by a format extractor (e.g. DOCX, PPTX, HTML).
   * When present, fast mode uses this directly instead of running its own
   * text-to-markdown heuristics. Never transmitted to an LLM.
   */
  preRenderedMarkdown?: string
}

export interface TextPosition {
  str: string
  x: number
  y: number
  width: number
  height: number
}

export interface PageComplexity {
  pageNumber: number
  isLikelyScan: boolean
  hasTablesDetected: boolean
  isMultiColumn: boolean
  textDensity: number
  suggestedMode: Exclude<ParseMode, 'auto'>
}

// ─── LLM client types ─────────────────────────────────────────────────────────

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | LLMContentPart[]
}

export interface LLMContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
    detail?: 'low' | 'high' | 'auto'
  }
}

export interface LLMRequest {
  model: string
  messages: LLMMessage[]
  temperature?: number
  max_tokens?: number
  response_format?: { type: 'text' | 'json_object' }
}

export interface LLMResponse {
  content: string
  tokensUsed?: number
}

export interface LLMClient {
  chat(request: LLMRequest): Promise<LLMResponse>
}
