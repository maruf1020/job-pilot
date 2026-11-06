'use client'

import type { PaginationMeta } from '@/lib/table-query/types'

export interface ApiEnvelope<T> {
  success: boolean
  statusCode: number
  message: string
  data: T
  meta?: PaginationMeta
  errors?: unknown
  timestamp: string
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const res = await fetch(url, {
    method,
    headers: { accept: 'application/json', ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}), ...(init?.headers ?? {}) },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    credentials: 'same-origin',
    ...init,
  })
  let json: ApiEnvelope<T> | null = null
  try {
    json = (await res.json()) as ApiEnvelope<T>
  } catch {
    /* non-JSON */
  }
  if (!res.ok || !json?.success) {
    if (res.status === 401 && typeof window !== 'undefined') {
      // Session expired: a full navigation clears client state (deliberately not router.push).
      window.location.assign(new URL(`/login?next=${encodeURIComponent(window.location.pathname)}`, window.location.origin).toString())
    }
    throw new ApiError(res.status, json?.message ?? `Request failed (${res.status})`, json?.errors)
  }
  return json
}

export const api = {
  get: <T>(url: string, init?: RequestInit) => request<T>('GET', url, undefined, init),
  post: <T>(url: string, body?: unknown, init?: RequestInit) => request<T>('POST', url, body ?? {}, init),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  delete: <T>(url: string) => request<T>('DELETE', url),
}

/** Serialize table state into the API query string. */
export function buildListUrl(base: string, params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const qs = sp.toString()
  return qs ? `${base}?${qs}` : base
}
