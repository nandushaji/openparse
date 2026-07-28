/**
 * Vitest globalSetup — runs ONCE in the main process before any worker starts.
 * Safe to write shared fixture files here because workers haven't launched yet.
 */
import { writeFile, mkdir, rename } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'

const FIXTURES = join(fileURLToPath(import.meta.url), '..', 'fixtures')

/** Builds a minimal valid single-page PDF containing the given text. */
function buildMinimalPdf(text: string): Buffer {
  const streamContent = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const stream = streamContent + '\n'

  const o1 = '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
  const o2 = '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  const o3 =
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R' +
    '/Resources<</Font<</F1 5 0 R>>>>>>endobj\n'
  const o4 = `4 0 obj<</Length ${stream.length}>>\nstream\n${stream}endstream\nendobj\n`
  const o5 = '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n'
  const bodies = ['', o1, o2, o3, o4, o5]

  const header = '%PDF-1.4\n'
  let pdf = header
  const offsets = [0, 0, 0, 0, 0, 0]

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

export async function setup() {
  await mkdir(FIXTURES, { recursive: true })

  const target = join(FIXTURES, 'simple.pdf')
  const tmp = target + '.tmp'
  await writeFile(tmp, buildMinimalPdf('OpenParse test document with some sample text'))
  await rename(tmp, target)
}

export async function teardown() {
  // Nothing to clean — keep fixture for inspection
}
