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

interface RequestOptions extends RequestInit {
  retries?: number
}

function retryable(status: number): boolean {
  return status === 404 || status === 408 || status === 429 || status >= 500
}

export async function requestJson<T>(url: string, options?: RequestOptions): Promise<T> {
  const { retries = 0, ...init } = options ?? {}
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { Accept: 'application/json', ...init.headers },
      })
      const body = await response.json().catch(() => null)
      if (response.ok) return body as T

      const apiMessage =
        typeof body === 'object' && body && 'message' in body ? String(body.message) : undefined
      lastError = new MoexApiError(
        apiMessage ?? `MOEX вернул ошибку ${response.status}`,
        response.status,
        body,
      )
      if (!retryable(response.status) || attempt === retries) throw lastError
    } catch (error) {
      lastError = error
      if (error instanceof MoexApiError && !retryable(error.status ?? 0)) throw error
      if (attempt === retries) break
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250 * 2 ** attempt))
  }

  if (lastError instanceof MoexApiError) throw lastError
  throw new MoexApiError(
    'Не удалось подключиться к MOEX. Проверьте соединение и повторите запрос.',
    undefined,
    lastError,
  )
}

export function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value))
  })
  const result = search.toString()
  return result ? `?${result}` : ''
}
