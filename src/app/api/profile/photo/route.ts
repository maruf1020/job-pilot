import fs from 'node:fs'
import { badRequest, notFound, ok, route } from '@/lib/api/response'
import { photoPath, removePhoto, savePhoto } from './store'

const MAX_BYTES = 2 * 1024 * 1024

/** Magic bytes, so a renamed file of another type is refused. */
function imageType(data: Buffer): 'jpg' | 'png' | null {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg'
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  return null
}

/** GET -> the saved photo (404 when there is none). */
export const GET = route(async () => {
  const p = photoPath()
  if (!p) throw notFound('Photo')
  const data = fs.readFileSync(p)
  return new Response(new Uint8Array(data), { headers: { 'content-type': p.endsWith('.png') ? 'image/png' : 'image/jpeg', 'cache-control': 'private, no-store' } })
})

/** POST multipart { file }: a JPG or PNG up to 2 MB, for forms that ask for a photo. */
export const POST = route(async (req) => {
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') throw badRequest('Upload a JPG or PNG as "file"')
  if (file.size > MAX_BYTES) throw badRequest('The photo is larger than 2 MB')
  const data = Buffer.from(await file.arrayBuffer())
  const type = imageType(data)
  if (!type) throw badRequest('Only JPG and PNG photos are supported')
  savePhoto(data, type)
  return ok({ saved: true }, { message: 'Photo saved' })
})

export const DELETE = route(async () => {
  removePhoto()
  return ok({ removed: true }, { message: 'Photo removed' })
})
