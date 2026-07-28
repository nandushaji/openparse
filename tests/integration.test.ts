/**
 * Integration tests: run the full parse() pipeline against real fixtures.
 * These tests use mode:'fast' so no LLM API key is required.
 */
import { describe, it, expect } from 'vitest'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { parse } from '../src/parse.js'

const FIXTURES = join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, 'fixtures')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePdfBuffer(text: string): Buffer {
  const streamContent = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const stream = streamContent + '\n'

  const o1 = '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
  const o2 = '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  const o3 = '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n'
  const o4 = `4 0 obj<</Length ${stream.length}>>\nstream\n${stream}endstream\nendobj\n`
  const o5 = '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n'

  const header = '%PDF-1.4\n'
  let pdf = header
  const offsets = [0, 0, 0, 0, 0, 0]
  const bodies = ['', o1, o2, o3, o4, o5]

  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length
    pdf += bodies[i]
  }

  const xrefPos = pdf.length
  let xref = 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i++) {
    xref += offsets[i].toString().padStart(10, '0') + ' 00000 n \n'
  }
  pdf += xref
  pdf += 'trailer<</Size 6/Root 1 0 R>>\n'
  pdf += `startxref\n${xrefPos}\n%%EOF\n`

  return Buffer.from(pdf)
}

// ─── PDF integration ──────────────────────────────────────────────────────────

describe('PDF integration (fast mode, no LLM)', () => {
  it('parses a PDF file path in fast mode', async () => {
    const result = await parse(join(FIXTURES, 'simple.pdf'), { mode: 'fast' })

    expect(result.metadata.filename).toBe('simple.pdf')
    expect(result.pages.length).toBeGreaterThan(0)
    expect(result.pages[0].modeUsed).toBe('fast')
    expect(result.usage.totalPages).toBeGreaterThan(0)
    expect(result.errors).toHaveLength(0)
    expect(result.markdown).toBeTruthy()
  })

  it('parses a PDF Buffer (magic byte detection)', async () => {
    const buffer = makePdfBuffer('Hello from buffer test')
    const result = await parse(buffer, { mode: 'fast' })

    expect(result.metadata.filename).toBe('document.pdf')
    expect(result.pages.length).toBeGreaterThan(0)
    expect(result.errors).toHaveLength(0)
  })

  it('returns correct ParseResult shape', async () => {
    const result = await parse(join(FIXTURES, 'simple.pdf'), { mode: 'fast' })

    // Top-level fields
    expect(typeof result.markdown).toBe('string')
    expect(typeof result.text).toBe('string')
    expect(Array.isArray(result.pages)).toBe(true)
    expect(Array.isArray(result.errors)).toBe(true)

    // Usage
    expect(typeof result.usage.totalPages).toBe('number')
    expect(typeof result.usage.durationMs).toBe('number')
    expect(typeof result.usage.estimatedTokens).toBe('number')

    // Metadata
    expect(typeof result.metadata.version).toBe('string')
    expect(result.metadata.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(typeof result.metadata.durationMs).toBe('number')
  })

  it('respects page range option', async () => {
    const result = await parse(join(FIXTURES, 'simple.pdf'), {
      mode: 'fast',
      pages: '1',
    })
    expect(result.pages.length).toBe(1)
  })

  it('calls onProgress during parsing', async () => {
    const progress: number[] = []
    await parse(join(FIXTURES, 'simple.pdf'), {
      mode: 'fast',
      onProgress: info => progress.push(info.percent),
    })
    expect(progress.length).toBeGreaterThan(0)
    expect(progress[progress.length - 1]).toBe(100)
  })
})

// ─── Buffer magic byte detection ─────────────────────────────────────────────

describe('Buffer sniffing', () => {
  it('detects a PNG buffer as image', async () => {
    // Minimal 1x1 PNG (89 bytes)
    const pngMagic = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG header
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ])

    // Should fail gracefully (no vision LLM configured) but not throw "unsupported format"
    await expect(parse(pngMagic, { mode: 'fast' })).resolves.toMatchObject({
      metadata: { filename: 'document.png' },
    })
  })

  it('throws on truly unsupported extension', async () => {
    // Write a temp file with an unsupported extension so readFile succeeds
    // but the extension check fires
    const { writeFile, unlink } = await import('fs/promises')
    const { tmpdir } = await import('os')
    const { join: pjoin } = await import('path')
    const tmp = pjoin(tmpdir(), `openparse-test-${Date.now()}.xyz`)
    await writeFile(tmp, 'dummy content')
    try {
      await expect(parse(tmp)).rejects.toThrow('Unsupported file type')
    } finally {
      await unlink(tmp).catch(() => {})
    }
  })
})

// ─── DOCX integration ─────────────────────────────────────────────────────────

describe('DOCX integration (fast mode, no LLM)', () => {
  it('parses a real DOCX file if present', async () => {
    const docxPath = join(FIXTURES, 'simple.docx')
    let buf: Buffer | null = null
    try {
      buf = await readFile(docxPath)
    } catch {
      // Fixture not present — generate a minimal DOCX on the fly using JSZip-free approach
    }

    if (!buf) {
      // Skip rather than fail when fixture is absent
      return
    }

    const result = await parse(docxPath, { mode: 'fast' })
    expect(result.pages.length).toBeGreaterThan(0)
    expect(result.errors).toHaveLength(0)
    expect(result.metadata.filename).toBe('simple.docx')
  })
})
