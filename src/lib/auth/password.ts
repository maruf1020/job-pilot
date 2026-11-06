import { hash, verify } from '@node-rs/argon2'

/** Argon2id, OWASP-minimum memory; ~50–100 ms per hash. */
const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
} as const

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS)
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, ARGON2_OPTIONS)
  } catch {
    return false
  }
}
