/** Minimal concurrency pool — limits simultaneous async task execution. */
export function createPool(concurrency: number) {
  let active = 0
  const queue: Array<() => void> = []

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        active++
        try {
          resolve(await fn())
        } catch (err) {
          reject(err)
        } finally {
          active--
          if (queue.length > 0) {
            const next = queue.shift()!
            next()
          }
        }
      }

      if (active < concurrency) {
        execute()
      } else {
        queue.push(execute)
      }
    })
  }
}
