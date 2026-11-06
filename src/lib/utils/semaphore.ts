/** Minimal counting semaphore for bounding concurrency without a dependency. */
export class Semaphore {
  private queue: Array<() => void> = []
  private active = 0

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++
      return () => this.release()
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++
        resolve(() => this.release())
      })
    })
  }

  private release() {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

/** Run `fn` over `items` with at most `limit` in flight; results in input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const sem = new Semaphore(limit)
  return Promise.all(items.map((item, i) => sem.run(() => fn(item, i))))
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
