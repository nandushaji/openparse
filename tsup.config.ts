import { defineConfig } from 'tsup'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pkg = require('./package.json') as { version: string }

const sharedDefine = {
  __LIB_VERSION__: JSON.stringify(pkg.version),
}

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    target: 'node20',
    external: ['pdfjs-dist', 'canvas'],
    define: sharedDefine,
    esbuildOptions(options) {
      options.conditions = ['module']
    },
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: false,
    target: 'node20',
    external: ['pdfjs-dist', 'canvas'],
    define: sharedDefine,
    banner: { js: '#!/usr/bin/env node' },
    esbuildOptions(options) {
      options.conditions = ['module']
    },
  },
])
