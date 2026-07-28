import type { ExtractedPage } from '../types.js'
import type { Logger } from '../utils/logger.js'

/**
 * Extracts content from XLSX / XLS / ODS / Numbers buffers using SheetJS.
 * Each worksheet becomes a separate ExtractedPage containing a GFM table.
 * CSV and TSV are also handled here (single-sheet documents).
 */
export async function extractSpreadsheetPages(
  buffer: Buffer,
  logger: Logger,
  opts: { delimiter?: string } = {}
): Promise<ExtractedPage[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let XLSX: any
  try {
    XLSX = await import('xlsx')
  } catch {
    throw new Error(
      'Spreadsheet parsing requires the "xlsx" package.\n' +
        '  Install it with: npm install xlsx'
    )
  }

  logger.log('Extracting spreadsheet with SheetJS…')

  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    raw: false,
    ...(opts.delimiter ? { FS: opts.delimiter } : {}),
  })

  const pages: ExtractedPage[] = []

  for (let sheetIdx = 0; sheetIdx < workbook.SheetNames.length; sheetIdx++) {
    const sheetName: string = workbook.SheetNames[sheetIdx]
    const sheet = workbook.Sheets[sheetName]

    // Convert sheet → array of rows (each row = array of cell values)
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as string[][]

    if (rows.length === 0) continue

    const markdown = sheetToMarkdown(sheetName, rows)
    const text = rows.map(r => r.join('\t')).join('\n')

    logger.log(`Sheet "${sheetName}": ${rows.length} rows × ${rows[0]?.length ?? 0} cols`)

    pages.push({
      pageNumber: sheetIdx + 1,
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      charCount: text.length,
      hasPositionData: false,
      preRenderedMarkdown: markdown,
    })
  }

  return pages
}

function sheetToMarkdown(sheetName: string, rows: string[][]): string {
  const parts: string[] = []

  if (sheetName && sheetName !== 'Sheet1') {
    parts.push(`## ${sheetName}\n`)
  }

  if (rows.length === 0) return parts.join('')

  const colCount = Math.max(...rows.map(r => r.length))
  const pad = (row: string[]) => {
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
