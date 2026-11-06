import fs from 'node:fs'
import path from 'node:path'

/**
 * The optional profile photo lives at storage/photo.jpg or storage/photo.png (the browser agent
 * reads it from there for "upload a photo" fields; "Remove my data" deletes it).
 */
const NAMES = ['photo.jpg', 'photo.jpeg', 'photo.png'] as const

function storageDir(): string {
  return path.resolve(process.cwd(), 'storage')
}

export function photoPath(): string | null {
  for (const name of NAMES) {
    const p = path.join(storageDir(), name)
    if (fs.existsSync(p)) return p
  }
  return null
}

export function removePhoto(): void {
  for (const name of NAMES) fs.rmSync(path.join(storageDir(), name), { force: true })
}

export function savePhoto(data: Buffer, ext: 'jpg' | 'png'): string {
  fs.mkdirSync(storageDir(), { recursive: true })
  removePhoto()
  const p = path.join(storageDir(), `photo.${ext}`)
  fs.writeFileSync(p, data)
  return p
}
