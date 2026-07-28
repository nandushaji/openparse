import { defineConfig } from 'vitest/config'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pkg = require('./package.json') as { version: string }

export default defineConfig({
  define: {
    __LIB_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    globals: false,
  },
})
