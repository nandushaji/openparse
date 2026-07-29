/** Injected by tsup at build time from package.json */
declare const __LIB_VERSION__: string

/** pdfjs-dist ships a Node-oriented legacy build without a typed package export. */
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export * from 'pdfjs-dist'
}
