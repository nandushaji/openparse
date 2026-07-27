import { defineConfig } from 'tsup'

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
    banner: { js: '#!/usr/bin/env node' },
    esbuildOptions(options) {
      options.conditions = ['module']
    },
  },
])
