export class MoexApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'MoexApiError'
  }
}

export interface RequestOptions extends RequestInit {
  retries?: number
  timeoutMs?: number
}

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      globalThis.clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, delay)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function retryAfterMs(value: string | null): number {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0
}

export async function requestJson<T>(url: string, options?: RequestOptions): Promise<T> {
  const { retries = 0, timeoutMs = 30_000, signal: callerSignal, ...init } = options ?? {}
  callerSignal?.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort(callerSignal?.reason)
  callerSignal?.addEventListener('abort', abort, { once: true })
  const timeoutError = new MoexApiError('Превышено время ожидания ответа API')
  const timer = globalThis.setTimeout(() => controller.abort(timeoutError), timeoutMs)
  const { signal } = controller
  let lastError: unknown

  try {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      signal.throwIfAborted()
      let retryDelay = 250 * 2 ** attempt
      let canRetry = true
      try {
        const response = await fetch(url, {
          ...init,
          signal,
          headers: { Accept: 'application/json', ...init.headers },
        })
        const body = await response.json().catch(() => null)
        signal.throwIfAborted()
        if (response.ok) return body as T

        const apiMessage =
          typeof body === 'object' && body && 'message' in body ? String(body.message) : undefined
        lastError = new MoexApiError(
          apiMessage ?? `MOEX вернул ошибку ${response.status}`,
          response.status,
          body,
        )
        // A structured backend error has already passed its upstream retry budget.
        // Legacy MOEX errors still receive bounded client-side retries.
        const handledByBackend =
          body && typeof body.code === 'string' && typeof body.retryable === 'boolean'
        canRetry = retryable(response.status) && !handledByBackend
        retryDelay = Math.max(retryDelay, retryAfterMs(response.headers.get('Retry-After')))
      } catch (error) {
        signal.throwIfAborted()
        if (isAbortError(error)) throw error
        lastError = error
      }
      if (!canRetry || attempt === retries) break
      await waitForRetry(retryDelay, signal)
    }
    if (lastError instanceof MoexApiError) throw lastError
    throw new MoexApiError(
      'Не удалось подключиться к MOEX. Проверьте соединение и повторите запрос.',
      undefined,
      lastError,
    )
  } finally {
    globalThis.clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abort)
  }
}

interface PendingRequest {
  controller: AbortController
  promise: Promise<unknown>
  subscribers: Set<symbol>
  settled: boolean
}

const pendingRequests = new Map<string, PendingRequest>()

export function requestSharedJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(options.signal.reason)
  if (options.body != null && typeof options.body !== 'string') return requestJson<T>(url, options)
  const key = JSON.stringify([
    url,
    options.method ?? 'GET',
    options.body,
    Array.from(new Headers(options.headers).entries()).sort(),
    options.retries,
    options.timeoutMs,
    options.credentials,
    options.mode,
    options.cache,
    options.redirect,
  ])
  let pending = pendingRequests.get(key)
  if (!pending) {
    const controller = new AbortController()
    const entry: PendingRequest = {
      controller,
      promise: Promise.resolve(),
      subscribers: new Set(),
      settled: false,
    }
    entry.promise = requestJson<T>(url, { ...options, signal: controller.signal }).finally(() => {
      entry.settled = true
      if (pendingRequests.get(key) === entry) pendingRequests.delete(key)
    })
    pendingRequests.set(key, entry)
    pending = entry
  }
  const entry = pending
  const subscriber = Symbol()
  entry.subscribers.add(subscriber)
  return new Promise<T>((resolve, reject) => {
    const finish = () => {
      options.signal?.removeEventListener('abort', abort)
      entry.subscribers.delete(subscriber)
      if (!entry.settled && entry.subscribers.size === 0) {
        if (pendingRequests.get(key) === entry) pendingRequests.delete(key)
        entry.controller.abort()
      }
    }
    const abort = () => {
      finish()
      reject(options.signal?.reason)
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    entry.promise.then(
      (value) => {
        finish()
        resolve(value as T)
      },
      (error: unknown) => {
        finish()
        reject(error)
      },
    )
  })
}

export function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value))
  })
  const result = search.toString()
  return result ? `?${result}` : ''
}
