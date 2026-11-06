import fs from 'node:fs'
import path from 'node:path'

/** The next update offset, kept in storage/telegram-offset.json so a restart never replays handled updates. */
export interface OffsetStore {
  load(): number
  save(offset: number): void
}

export function fileOffsetStore(file = path.resolve(process.cwd(), 'storage', 'telegram-offset.json')): OffsetStore {
  return {
    load() {
      try {
        const n = Number((JSON.parse(fs.readFileSync(file, 'utf8')) as { offset?: unknown }).offset)
        return Number.isSafeInteger(n) && n >= 0 ? n : 0
      } catch {
        return 0
      }
    },
    save(offset) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const tmp = `${file}.tmp`
        fs.writeFileSync(tmp, JSON.stringify({ offset }))
        fs.renameSync(tmp, file)
      } catch {
        // Losing the offset only means the (age-limited) backlog is read again.
      }
    },
  }
}
