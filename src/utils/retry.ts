/** Retry fn with exponential backoff. Retries on any thrown error. */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
  const { attempts = 3, delayMs = 500 } = options
  let lastError: unknown

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (i < attempts - 1) {
        const wait = delayMs * 2 ** i
        await new Promise<void>(resolve => setTimeout(resolve, wait))
      }
    }
  }

  throw lastError
}
