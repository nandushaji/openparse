/**
 * Format coverage tests — exercises all new extractors introduced in feat/format-coverage.
 * These tests avoid real file I/O by building minimal in-memory representations.
 */
import { describe, it, expect } from 'vitest'
import { extractPlaintextPage } from '../src/extract/plaintext.js'
import { extractSpreadsheetPages } from '../src/extract/xlsx.js'
import { extractPptxPages } from '../src/extract/pptx.js'
import { htmlToMarkdown } from '../src/utils/htmlToMarkdown.js'
import { createLogger } from '../src/utils/logger.js'
import JSZip from 'jszip'

const logger = createLogger(false)

// ─── htmlToMarkdown unit tests ────────────────────────────────────────────────

describe('htmlToMarkdown', () => {
  it('converts headings', () => {
    expect(htmlToMarkdown('<h1>Title</h1>')).toBe('# Title')
    expect(htmlToMarkdown('<h3>Sub</h3>')).toBe('### Sub')
  })

  it('converts bold and italic', () => {
    expect(htmlToMarkdown('<strong>bold</strong>')).toBe('**bold**')
    expect(htmlToMarkdown('<em>ital</em>')).toBe('*ital*')
  })

  it('converts unordered lists', () => {
    const html = '<ul><li>Alpha</li><li>Beta</li></ul>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('- Alpha')
    expect(md).toContain('- Beta')
  })

  it('converts ordered lists', () => {
    const html = '<ol><li>One</li><li>Two</li></ol>'
    const md = htmlToMarkdown(html)
    expect(md).toContain('1. One')
    expect(md).toContain('2. Two')
  })

  it('converts a simple table to GFM', () => {
    const html = `<table>
      <tr><th>Name</th><th>Age</th></tr>
      <tr><td>Alice</td><td>30</td></tr>
    </table>`
    const md = htmlToMarkdown(html)
    expect(md).toContain('| Name | Age |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| Alice | 30 |')
  })

  it('decodes HTML entities', () => {
    expect(htmlToMarkdown('AT&amp;T &lt;rocks&gt;')).toBe('AT&T <rocks>')
  })

  it('strips remaining tags', () => {
    const md = htmlToMarkdown('<div class="x"><span>content</span></div>')
    expect(md).toBe('content')
  })
})

// ─── plaintext extractor ─────────────────────────────────────────────────────

describe('extractPlaintextPage — TXT', () => {
  it('returns single page with text and preRenderedMarkdown', async () => {
    const buf = Buffer.from('Hello world\nSecond line')
    const pages = await extractPlaintextPage(buf, '.txt', logger)
    expect(pages).toHaveLength(1)
    expect(pages[0].pageNumber).toBe(1)
    expect(pages[0].text).toContain('Hello world')
    expect(pages[0].preRenderedMarkdown).toContain('Hello world')
  })
})

describe('extractPlaintextPage — HTML', () => {
  it('converts HTML to markdown and strips tags from text', async () => {
    const html = '<h1>Title</h1><p>Paragraph text</p>'
    const buf = Buffer.from(html)
    const pages = await extractPlaintextPage(buf, '.html', logger)
    expect(pages).toHaveLength(1)
    expect(pages[0].preRenderedMarkdown).toMatch(/^# Title/)
    expect(pages[0].preRenderedMarkdown).toContain('Paragraph text')
  })

  it('strips script and style blocks', async () => {
    const html = '<head><style>body{}</style></head><body><p>Content</p></body>'
    const buf = Buffer.from(html)
    const [page] = await extractPlaintextPage(buf, '.html', logger)
    expect(page.preRenderedMarkdown).not.toContain('body{}')
    expect(page.preRenderedMarkdown).toContain('Content')
  })
})

describe('extractPlaintextPage — Markdown', () => {
  it('passes markdown through unchanged', async () => {
    const md = '# Hello\n\n- item 1\n- item 2'
    const buf = Buffer.from(md)
    const pages = await extractPlaintextPage(buf, '.md', logger)
    expect(pages[0].preRenderedMarkdown).toBe(md)
  })
})

// ─── spreadsheet extractor ────────────────────────────────────────────────────

describe('extractSpreadsheetPages — XLSX', () => {
  it('returns one page per sheet as GFM table', async () => {
    // Build a minimal XLSX in memory using xlsx library
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Score'],
      ['Alice', '95'],
      ['Bob', '87'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Results')
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)

    const pages = await extractSpreadsheetPages(buf, logger)
    expect(pages).toHaveLength(1)

    const md = pages[0].preRenderedMarkdown!
    expect(md).toContain('| Name | Score |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| Alice | 95 |')
    expect(md).toContain('| Bob | 87 |')
  })

  it('returns multiple pages for multi-sheet workbooks', async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['A']]), 'Sheet1')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['B']]), 'Sheet2')
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)

    const pages = await extractSpreadsheetPages(buf, logger)
    expect(pages).toHaveLength(2)
    expect(pages[0].pageNumber).toBe(1)
    expect(pages[1].pageNumber).toBe(2)
  })
})

// ─── PPTX extractor ───────────────────────────────────────────────────────────

/** Build a minimal PPTX buffer with N slides containing the given texts. */
async function buildMinimalPptx(slides: string[]): Promise<Buffer> {
  const zip = new JSZip()

  // Minimal [Content_Types].xml required for PPTX to be a valid Open XML package
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`
  )

  for (let i = 0; i < slides.length; i++) {
    const slideXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:p><a:r><a:t>${slides[i]}</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
    zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml)
  }

  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  return buf
}

describe('extractPptxPages', () => {
  it('returns one page per slide', async () => {
    const buf = await buildMinimalPptx(['Slide One', 'Slide Two', 'Slide Three'])
    const pages = await extractPptxPages(buf, logger)

    expect(pages).toHaveLength(3)
    expect(pages[0].pageNumber).toBe(1)
    expect(pages[1].pageNumber).toBe(2)
    expect(pages[2].pageNumber).toBe(3)
  })

  it('extracts text content from slides', async () => {
    const buf = await buildMinimalPptx(['Introduction', 'Key Points'])
    const pages = await extractPptxPages(buf, logger)

    expect(pages[0].text).toContain('Introduction')
    expect(pages[1].text).toContain('Key Points')
  })

  it('sets preRenderedMarkdown', async () => {
    const buf = await buildMinimalPptx(['My Heading'])
    const pages = await extractPptxPages(buf, logger)

    expect(pages[0].preRenderedMarkdown).toBeDefined()
    expect(pages[0].preRenderedMarkdown!.length).toBeGreaterThan(0)
  })

  it('returns empty array for PPTX with no slides', async () => {
    const buf = await buildMinimalPptx([])
    const pages = await extractPptxPages(buf, logger)
    expect(pages).toHaveLength(0)
  })
})
