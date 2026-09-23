import { afterEach, describe, expect, it, vi } from 'vitest'

import { MoexApiError, queryString, requestJson, requestSharedJson } from './http'

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('queryString', () => {
  it('encodes values and omits empty parameters', () => {
    expect(queryString({ query: 'Si futures', asset_type: 'futures', empty: undefined })).toBe(
      '?query=Si+futures&asset_type=futures',
    )
  })

  it('returns an empty string when no parameters are present', () => {
    expect(queryString({ query: '', page: undefined })).toBe('')
  })
})

describe('requestJson', () => {
  it('retries transient MOEX responses', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ asset_code: 'SBER' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const result = requestJson<Array<{ asset_code: string }>>('/assets', { retries: 1 })
    await vi.runAllTimersAsync()

    await expect(result).resolves.toEqual([{ asset_code: 'SBER' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([true, false])(
    'does not repeat structured Rust failures (retryable=%s)',
    async (retryable) => {
      const body = { code: 'LIVE_DATA_UNAVAILABLE', message: 'missing live IV', retryable }
      const fetchMock = vi.fn().mockResolvedValue(json(body, 503))
      vi.stubGlobal('fetch', fetchMock)

      await expect(requestJson('/rust-error', { retries: 2 })).rejects.toMatchObject({
        status: 503,
        message: body.message,
        details: body,
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('does not retry a missing legacy resource', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ message: 'not found' }, 404))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestJson('/missing', { retries: 2 })).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('bounds the number of legacy 500 attempts', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({}, 500)))
    vi.stubGlobal('fetch', fetchMock)
    const assertion = expect(requestJson('/legacy-error', { retries: 2 })).rejects.toMatchObject({
      status: 500,
    })

    await vi.runAllTimersAsync()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it.each(['2', 'Wed, 23 Sep 2026 12:00:02 GMT'])('honors Retry-After: %s', async (retryAfter) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': retryAfter }))
      .mockResolvedValueOnce(json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const result = requestJson('/rate-limited', { retries: 1 })

    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('applies one total timeout across requests and retry waits', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(json({}, 503, { 'Retry-After': '10' }))
    vi.stubGlobal('fetch', fetchMock)
    const assertion = expect(
      requestJson('/deadline', { retries: 5, timeoutMs: 1_000 }),
    ).rejects.toBeInstanceOf(MoexApiError)

    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts a stalled fetch when the total deadline expires', async () => {
    vi.useFakeTimers()
    let fetchSignal: AbortSignal | undefined
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          fetchSignal = init.signal!
          fetchSignal.addEventListener('abort', () => reject(fetchSignal!.reason), { once: true })
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const assertion = expect(
      requestJson('/stalled', { retries: 2, timeoutMs: 500 }),
    ).rejects.toBeInstanceOf(MoexApiError)
    await vi.advanceTimersByTimeAsync(500)
    await assertion
    expect(fetchSignal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a retry wait without making another attempt', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(json({}, 500))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const assertion = expect(
      requestJson('/cancel-retry', { retries: 2, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.runAllTimersAsync()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not fetch when already cancelled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()
    await expect(
      requestJson('/cancelled', { retries: 2, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('requestSharedJson', () => {
  it.each(['GET', 'POST'])(
    'shares only overlapping identical %s requests, not completed data',
    async (method) => {
      const response = deferred<Response>()
      const fetchMock = vi
        .fn()
        .mockReturnValueOnce(response.promise)
        .mockResolvedValueOnce(json({ revision: 2 }))
      vi.stubGlobal('fetch', fetchMock)
      const options = { method, ...(method === 'POST' ? { body: '{"quantity":1}' } : {}) }
      const first = requestSharedJson('/shared', options)
      const second = requestSharedJson('/shared', options)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      response.resolve(json({ revision: 1 }))
      await expect(Promise.all([first, second])).resolves.toEqual([
        { revision: 1 },
        { revision: 1 },
      ])
      await expect(requestSharedJson('/shared', options)).resolves.toEqual({ revision: 2 })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    },
  )

  it('does not share different URLs, payloads or headers', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([
      requestSharedJson('/series/A', { method: 'POST', body: '{"quantity":1}' }),
      requestSharedJson('/series/B', { method: 'POST', body: '{"quantity":1}' }),
      requestSharedJson('/series/A', { method: 'POST', body: '{"quantity":2}' }),
      requestSharedJson('/series/A', {
        method: 'POST',
        body: '{"quantity":1}',
        headers: { 'X-Mode': 'market' },
      }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('clears a failed shared request so the next caller can retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ code: 'UNAVAILABLE', retryable: false }, 503))
      .mockResolvedValueOnce(json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const first = requestSharedJson('/failed-shared')
    const second = requestSharedJson('/failed-shared')
    const results = await Promise.allSettled([first, second])
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(requestSharedJson('/failed-shared')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cancel other subscribers when one aborts', async () => {
    const response = deferred<Response>()
    let fetchSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      fetchSignal = init.signal!
      return response.promise
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const first = requestSharedJson('/subscribers', { signal: controller.signal })
    const second = requestSharedJson('/subscribers')
    const assertion = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
    expect(fetchSignal?.aborted).toBe(false)
    response.resolve(json({ ok: true }))
    await expect(second).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('cancels the underlying fetch after the last subscriber and permits an immediate new request', async () => {
    const oldResponse = deferred<Response>()
    const newResponse = deferred<Response>()
    let oldSignal: AbortSignal | undefined
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        oldSignal = init.signal!
        return oldResponse.promise
      })
      .mockImplementationOnce(() => newResponse.promise)
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const secondController = new AbortController()
    const cancelled = requestSharedJson('/last-subscriber', { signal: controller.signal })
    const secondCancelled = requestSharedJson('/last-subscriber', {
      signal: secondController.signal,
    })
    const assertion = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    const secondAssertion = expect(secondCancelled).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
    expect(oldSignal?.aborted).toBe(false)
    secondController.abort()
    await secondAssertion
    expect(oldSignal?.aborted).toBe(true)
    const replacement = requestSharedJson('/last-subscriber')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    oldResponse.reject(new DOMException('Cancelled', 'AbortError'))
    await Promise.resolve()
    await Promise.resolve()
    const joinedReplacement = requestSharedJson('/last-subscriber')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    newResponse.resolve(json({ ok: true }))
    await expect(Promise.all([replacement, joinedReplacement])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ])
  })

  it('keeps credentials and cache modes distinct', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([
      requestSharedJson('/policy', { credentials: 'include' }),
      requestSharedJson('/policy', { credentials: 'omit' }),
      requestSharedJson('/policy', { credentials: 'omit', cache: 'no-store' }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
