import { createRequire } from 'module'
import { pathToFileURL } from 'url'

/**
 * Shared pdfjs-dist loader for Node.js.
 *
 * Uses the `legacy` build — the modern build prints
 * "Please use the `legacy` build in Node.js environments." on every import.
 */
let pdfjsLib: typeof import('pdfjs-dist') | null = null

export async function getPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsLib) return pdfjsLib

  // The legacy entry has no typed package export; cast through the main types.
  const lib = (await import(
    'pdfjs-dist/legacy/build/pdf.mjs'
  )) as typeof import('pdfjs-dist')

  try {
    const req = createRequire(import.meta.url)
    const workerPath = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  } catch {
    // Empty string → FakeWorker (main-thread, synchronous)
    lib.GlobalWorkerOptions.workerSrc = ''
  }

  pdfjsLib = lib
  return lib
}
