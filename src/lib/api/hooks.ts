'use client'

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, ApiError, type ApiEnvelope } from './client'

export function useApiQuery<T>(key: unknown[], url: string | null, options?: Omit<UseQueryOptions<ApiEnvelope<T>, ApiError>, 'queryKey' | 'queryFn'>) {
  return useQuery<ApiEnvelope<T>, ApiError>({
    queryKey: [...key, url],
    queryFn: () => api.get<T>(url!),
    enabled: Boolean(url) && (options?.enabled ?? true),
    ...options,
  })
}

interface MutationOpts<TData> {
  /** Query key prefixes to invalidate on success. */
  invalidate?: unknown[][]
  successMessage?: string | ((data: TData, envelope: ApiEnvelope<TData>) => string | undefined)
  onSuccess?: (data: TData, envelope: ApiEnvelope<TData>) => void
  silent?: boolean
}

export function useApiMutation<TVars, TData = unknown>(
  fn: (vars: TVars) => Promise<ApiEnvelope<TData>>,
  opts: MutationOpts<TData> = {},
) {
  const qc = useQueryClient()
  return useMutation<ApiEnvelope<TData>, ApiError, TVars>({
    mutationFn: fn,
    onSuccess: (env) => {
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: k })
      const msg = typeof opts.successMessage === 'function' ? opts.successMessage(env.data, env) : (opts.successMessage ?? env.message)
      if (!opts.silent && msg && msg !== 'OK') toast.success(msg)
      opts.onSuccess?.(env.data, env)
    },
    onError: (err) => {
      if (!opts.silent) toast.error(err.message)
    },
  })
}

export { api, ApiError }
export type { ApiEnvelope }
