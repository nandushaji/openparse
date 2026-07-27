export interface Logger {
  log(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export function createLogger(debug: boolean): Logger {
  return {
    log: debug ? (...args: unknown[]) => console.error('[openparse]', ...args) : () => {},
    warn: (...args: unknown[]) => console.error('[openparse:warn]', ...args),
    error: (...args: unknown[]) => console.error('[openparse:error]', ...args),
  }
}
