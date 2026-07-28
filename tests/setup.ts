import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'

// ─── Node 20 polyfill ─────────────────────────────────────────────────────────
// Promise.withResolvers was added in Node 22.0.0 / V8 11.8.
// pdfjs-dist v4 uses it internally. Polyfill here so integration tests pass on Node 20.
if (typeof Promise.withResolvers === 'undefined') {
  // @ts-expect-error polyfill for Node < 22
  Promise.withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

// ─── Generate test fixtures ────────────────────────────────────────────────────

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

await mkdir(FIXTURES, { recursive: true })
await writeFile(
  join(FIXTURES, 'simple.pdf'),
  buildMinimalPdf('OpenParse test document with some sample text for extraction')
)
