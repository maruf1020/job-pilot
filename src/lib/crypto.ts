import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const KEY_LENGTH = 32

function deriveKey(secret: string = env.APP_ENCRYPTION_KEY): Buffer {
  return createHash('sha256').update(secret).digest().subarray(0, KEY_LENGTH)
}

/** AES-256-GCM; output is `iv:authTag:ciphertext` (all hex). */
export function encryptSecret(plaintext: string, secret?: string): string {
  const key = deriveKey(secret)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptSecret(payload: string, secret?: string): string {
  const parts = payload.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted payload format')
  const [ivHex, tagHex, dataHex] = parts
  const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()])
  return decrypted.toString('utf8')
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

export function sha1(input: string | Buffer): string {
  return createHash('sha1').update(input).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export function keyHint(key: string): string {
  return key.length <= 4 ? '****' : `…${key.slice(-4)}`
}
