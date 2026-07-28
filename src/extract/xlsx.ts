/**
 * Lightweight XLSX / CSV / TSV extractor.
 *
 * XLSX is the Open XML SpreadsheetML format — a ZIP file containing XML worksheets.
 * We parse it with JSZip (already a dependency for PPTX) so no additional
 * dependencies — and no SheetJS/xlsx CVEs — are introduced.
 *
 * Supported inputs:
 *  - .xlsx / .xlsm  — SpreadsheetML ZIP format
 *  - .csv / .tsv    — delimiter-separated plain text
 *
 * For each worksheet, one ExtractedPage is returned with preRenderedMarkdown
 * containing a GFM table so fast mode produces clean output without any LLM call.
 */

import type { ExtractedPage } from '../types.js'
import type { Logger } from '../utils/logger.js'

// ─── Main entry points ────────────────────────────────────────────────────────

export async function extractSpreadsheetPages(
  buffer: Buffer,
  logger: Logger,
  opts: { delimiter?: string } = {}
): Promise<ExtractedPage[]> {
  // CSV / TSV — no ZIP, just parse directly
  if (opts.delimiter) {
    return parseCsv(buffer.toString('utf-8'), opts.delimiter, logger)
  }

  return parseXlsx(buffer, logger)
}

// ─── CSV / TSV ────────────────────────────────────────────────────────────────

function parseCsv(content: string, delimiter: string, logger: Logger): ExtractedPage[] {
  logger.log(`Parsing ${delimiter === '\t' ? 'TSV' : 'CSV'} file…`)

  const lines = content.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return []

  const rows = lines.map(line => splitCsvLine(line, delimiter))
  const text = rows.map(r => r.join(delimiter)).join('\n')
  const markdown = rowsToGfmTable(rows, 'Sheet1')

  return [
    {
      pageNumber: 1,
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      charCount: text.length,
      hasPositionData: false,
      preRenderedMarkdown: markdown,
    },
  ]
}

/** RFC 4180-compliant CSV splitter that handles quoted fields. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

// ─── XLSX ─────────────────────────────────────────────────────────────────────

async function parseXlsx(buffer: Buffer, logger: Logger): Promise<ExtractedPage[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let JSZip: any
  try {
    JSZip = (await import('jszip')).default
  } catch {
    throw new Error(
      'XLSX parsing requires the "jszip" package.\n' +
        '  Install it with: npm install jszip'
    )
  }

  logger.log('Parsing XLSX with built-in SpreadsheetML reader…')

  const zip = await JSZip.loadAsync(buffer)

  // ── Parse shared strings table ───────────────────────────────────────────
  const sharedStrings = await parseSharedStrings(zip)

  // ── Get workbook sheet list ──────────────────────────────────────────────
  const workbook = await parseWorkbook(zip)
  if (workbook.length === 0) {
    logger.log('XLSX: no sheets found')
    return []
  }

  // ── Parse each sheet ─────────────────────────────────────────────────────
  const pages: ExtractedPage[] = []

  for (let i = 0; i < workbook.length; i++) {
    const { name, relId } = workbook[i]
    const sheetPath = await resolveSheetPath(zip, relId)
    if (!sheetPath) continue

    const sheetXml: string = await zip.files[sheetPath].async('string')
    const rows = extractSheetRows(sheetXml, sharedStrings)

    if (rows.length === 0) continue

    const text = rows.map(r => r.join('\t')).join('\n')
    const markdown = rowsToGfmTable(rows, name)

    logger.log(`XLSX sheet "${name}": ${rows.length} rows × ${rows[0]?.length ?? 0} cols`)

    pages.push({
      pageNumber: i + 1,
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      charCount: text.length,
      hasPositionData: false,
      preRenderedMarkdown: markdown,
    })
  }

  return pages
}

// ─── Shared strings ───────────────────────────────────────────────────────────

async function parseSharedStrings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zip: any
): Promise<string[]> {
  const file = zip.files['xl/sharedStrings.xml']
  if (!file) return []

  const xml: string = await file.async('string')
  const strings: string[] = []

  // Each <si> element is one shared string; text content is in <t> tags
  const siRegex = /<si>([\s\S]*?)<\/si>/g
  let siMatch: RegExpExecArray | null

  while ((siMatch = siRegex.exec(xml)) !== null) {
    const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g
    let tMatch: RegExpExecArray | null
    const parts: string[] = []

    while ((tMatch = tRegex.exec(siMatch[1])) !== null) {
      parts.push(decodeXml(tMatch[1]))
    }

    strings.push(parts.join(''))
  }

  return strings
}

// ─── Workbook sheet registry ──────────────────────────────────────────────────

interface SheetRef {
  name: string
  relId: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseWorkbook(zip: any): Promise<SheetRef[]> {
  const wbFile = zip.files['xl/workbook.xml']
  if (!wbFile) return []

  const xml: string = await wbFile.async('string')
  const sheets: SheetRef[] = []

  const sheetRegex = /<sheet\s+([^/]+?)\/>/g
  let m: RegExpExecArray | null

  while ((m = sheetRegex.exec(xml)) !== null) {
    const attrs = m[1]
    const nameMatch = attrs.match(/name="([^"]*)"/)
    const relIdMatch = attrs.match(/r:id="([^"]*)"/)
    if (nameMatch && relIdMatch) {
      sheets.push({ name: decodeXml(nameMatch[1]), relId: relIdMatch[1] })
    }
  }

  return sheets
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveSheetPath(zip: any, relId: string): Promise<string | null> {
  const relsFile = zip.files['xl/_rels/workbook.xml.rels']
  if (!relsFile) return null

  const xml: string = await relsFile.async('string')
  const relRegex = new RegExp(`Id="${escapeRegex(relId)}"[^>]+Target="([^"]+)"`)
  const m = xml.match(relRegex)
  if (!m) return null

  const target = m[1]
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`
}

// ─── Sheet row extraction ─────────────────────────────────────────────────────

function extractSheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = []

  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch: RegExpExecArray | null

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowXml = rowMatch[1]
    const cells: string[] = []
    let lastCol = -1

    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g
    let cellMatch: RegExpExecArray | null

    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const attrs = cellMatch[1]
      const inner = cellMatch[2]

      // Determine column index from the cell reference (e.g. "A1" → column 0)
      const refMatch = attrs.match(/r="([A-Z]+)\d+"/)
      const colIdx = refMatch ? colLetterToIndex(refMatch[1]) : lastCol + 1

      // Gap-fill empty cells
      while (cells.length < colIdx) cells.push('')

      // Cell type — 's' = shared string, else numeric/formula/date value
      const isShared = /t="s"/.test(attrs)
      const valueMatch = inner.match(/<v>([\s\S]*?)<\/v>/)
      let value = ''

      if (valueMatch) {
        if (isShared) {
          const idx = parseInt(valueMatch[1], 10)
          value = sharedStrings[idx] ?? ''
        } else {
          value = decodeXml(valueMatch[1])
        }
      }

      // Inline string (t="inlineStr")
      if (/t="inlineStr"/.test(attrs)) {
        const isMatch = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)
        if (isMatch) value = decodeXml(isMatch[1])
      }

      cells.push(value)
      lastCol = colIdx
    }

    if (cells.some(c => c.trim())) {
      rows.push(cells)
    }
  }

  return rows
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function colLetterToIndex(letters: string): number {
  let result = 0
  for (let i = 0; i < letters.length; i++) {
    result = result * 26 + (letters.charCodeAt(i) - 64)
  }
  return result - 1
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rowsToGfmTable(rows: string[][], sheetName: string): string {
  const parts: string[] = []

  if (sheetName && sheetName !== 'Sheet1') {
    parts.push(`## ${sheetName}\n`)
  }

  if (rows.length === 0) return parts.join('')

  const colCount = Math.max(...rows.map(r => r.length))
  const pad = (row: string[]): string[] => {
    const padded = row.map(cell => String(cell ?? '').replace(/\|/g, '\\|'))
    while (padded.length < colCount) padded.push('')
    return padded
  }

  const toRow = (cells: string[]) => `| ${cells.join(' | ')} |`

  const header = pad(rows[0])
  const separator = header.map(() => '---')
  const body = rows.slice(1).filter(r => r.some(c => String(c ?? '').trim())).map(pad)

  parts.push(toRow(header))
  parts.push(toRow(separator))
  for (const row of body) {
    parts.push(toRow(row))
  }

  return parts.join('\n')
}
