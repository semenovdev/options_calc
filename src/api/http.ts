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

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
    })
  } catch (error) {
    throw new MoexApiError(
      'Не удалось подключиться к MOEX. Проверьте соединение и повторите запрос.',
      undefined,
      error,
    )
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const apiMessage =
      typeof body === 'object' && body && 'message' in body ? String(body.message) : undefined
    throw new MoexApiError(
      apiMessage ?? `MOEX вернул ошибку ${response.status}`,
      response.status,
      body,
    )
  }
  return body as T
}

export function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value))
  })
  const result = search.toString()
  return result ? `?${result}` : ''
}
