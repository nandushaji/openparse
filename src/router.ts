import type { ExtractedPage, PageComplexity, ParseMode } from './types.js'

// Thresholds (tunable)
const SCAN_WORD_THRESHOLD = 12        // words/page below this → likely scanned
const TABLE_PIPE_RATIO = 0.04         // pipe chars / total chars
const TABLE_TAB_THRESHOLD = 6         // raw tab characters per page
const MULTICOLUMN_BALANCE_THRESHOLD = 0.25  // left/right balance to flag two-column
const MULTICOLUMN_X_SPREAD_PT = 150   // minimum x spread in PDF points to check balance
const DENSE_TEXT_CHARS = 400          // chars above which a page is "text-dense"

/**
 * Classify a single page and recommend a parsing mode.
 * If forcedMode is provided, it is returned directly without analysis.
 */
export function classifyPage(
  page: ExtractedPage,
  forcedMode?: Exclude<ParseMode, 'auto'>
): PageComplexity {
  if (forcedMode) {
    return {
      pageNumber: page.pageNumber,
      isLikelyScan: false,
      hasTablesDetected: false,
      isMultiColumn: false,
      textDensity: 1,
      suggestedMode: forcedMode,
    }
  }

  const { text, wordCount, charCount, positions } = page

  // 1. Scan detection: very few words extracted
  const isLikelyScan = wordCount < SCAN_WORD_THRESHOLD

  // 2. Table detection via pipe/tab density
  const pipeCount = (text.match(/\|/g) ?? []).length
  const tabCount = (text.match(/\t/g) ?? []).length
  const hasTablesDetected =
    charCount > 10 &&
    (pipeCount / charCount > TABLE_PIPE_RATIO || tabCount > TABLE_TAB_THRESHOLD)

  // 3. Multi-column detection using x-position clustering
  let isMultiColumn = false
  if (positions && positions.length > 15) {
    const xVals = positions.map(p => p.x)
    const xMin = Math.min(...xVals)
    const xMax = Math.max(...xVals)
    const xRange = xMax - xMin

    if (xRange > MULTICOLUMN_X_SPREAD_PT) {
      const midX = xMin + xRange / 2
      const leftCount = xVals.filter(x => x < midX).length
      const rightCount = xVals.filter(x => x >= midX).length
      const total = leftCount + rightCount
      const balance =
        total > 0 ? Math.min(leftCount, rightCount) / Math.max(leftCount, rightCount) : 0
      isMultiColumn = balance >= MULTICOLUMN_BALANCE_THRESHOLD
    }
  }

  // 4. Text density: normalised character count
  const textDensity = Math.min(1, charCount / DENSE_TEXT_CHARS)

  // 5. Mode selection logic
  let suggestedMode: Exclude<ParseMode, 'auto'>

  if (isLikelyScan) {
    suggestedMode = 'agentic'
  } else if (hasTablesDetected || isMultiColumn) {
    // Structured content → LLM reconstruction
    suggestedMode = 'cost_effective'
  } else if (textDensity >= 0.5) {
    // Dense clean text → fast path
    suggestedMode = 'fast'
  } else {
    // Sparse/ambiguous → safe middle ground
    suggestedMode = 'cost_effective'
  }

  return {
    pageNumber: page.pageNumber,
    isLikelyScan,
    hasTablesDetected,
    isMultiColumn,
    textDensity,
    suggestedMode,
  }
}
