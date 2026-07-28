/**
 * Vitest per-worker setup (setupFiles) — runs in each test worker thread.
 * Fixture files are generated in tests/globalSetup.ts (runs once, before workers start).
 */

// ─── Node 20 polyfill ─────────────────────────────────────────────────────────
// Promise.withResolvers was added in Node 22.0.0 / V8 11.8.
// pdfjs-dist v4 uses it internally. Polyfill so tests pass on Node 20.
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
