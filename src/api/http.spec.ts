import { afterEach, describe, expect, it, vi } from 'vitest'

import { queryString, requestJson } from './http'

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
})
