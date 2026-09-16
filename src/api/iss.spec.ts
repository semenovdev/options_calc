import { afterEach, describe, expect, it, vi } from 'vitest'

import { getMarketPrice } from './iss'

afterEach(() => vi.unstubAllGlobals())

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('getMarketPrice', () => {
  it('falls back to FORTS marketdata for futures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}))
        .mockResolvedValueOnce(
          jsonResponse({ marketdata: { columns: ['SECID', 'LAST'], data: [['GZU6', 9377]] } }),
        ),
    )
    await expect(getMarketPrice('GZU6')).resolves.toMatchObject({ price: 9377, source: 'LAST' })
  })

  it('prefers a board with the latest trade for shares', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}))
        .mockResolvedValueOnce(jsonResponse({}))
        .mockResolvedValueOnce(
          jsonResponse({
            marketdata: {
              columns: ['SECID', 'LAST', 'MARKETPRICE'],
              data: [
                ['SBER', null, 285.84],
                ['SBER', 279.94, 285.84],
              ],
            },
          }),
        ),
    )
    await expect(getMarketPrice('SBER')).resolves.toMatchObject({ price: 279.94, source: 'LAST' })
  })
})
