import { afterEach, describe, expect, it, vi } from 'vitest'

import { getInstrumentSpecification, getMarketPrice } from './iss'

afterEach(() => vi.unstubAllGlobals())

function issResponse(
  marketdata: Record<string, unknown>[],
  securities: Record<string, unknown>[] = [],
): Response {
  const block = (rows: Record<string, unknown>[]) => {
    const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    return { columns, data: rows.map((row) => columns.map((column) => row[column] ?? null)) }
  }
  return new Response(
    JSON.stringify({ marketdata: block(marketdata), securities: block(securities) }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('MOEX ISS prices', () => {
  it.each([
    ['GLDRUB_TOM', 'commodity', 0.5, 1],
    ['SLVRUB_TOM', 'commodity', 0.05, 100],
    ['CNYRUB_TOM', 'currency', 0.0005, 1000],
  ] as const)(
    'loads %s spot specifications in legacy MOEX mode',
    async (secid, type, minStep, lotSize) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          issResponse(
            [{ SECID: secid, BID: 100, OFFER: 102 }],
            [{ SECID: secid, MINSTEP: minStep, LOTSIZE: lotSize }],
          ),
        )
      vi.stubGlobal('fetch', fetch)
      await expect(getInstrumentSpecification(secid, type)).resolves.toMatchObject({
        secid,
        price: 101,
        minStep,
        lotSize,
        stepPrice: minStep * lotSize,
      })
      expect(fetch.mock.calls[0]?.[0]).toContain(
        `/engines/currency/markets/selt/boards/CETS/securities/${secid}.json`,
      )
    },
  )

  it.each([0, -1, null])('rejects invalid spot lot size %s', async (lotSize) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          issResponse(
            [{ SECID: 'GLDRUB_TOM', BID: 100, OFFER: 102 }],
            [{ SECID: 'GLDRUB_TOM', MINSTEP: 0.5, LOTSIZE: lotSize }],
          ),
        ),
    )
    await expect(getInstrumentSpecification('GLDRUB_TOM', 'commodity')).rejects.toThrow(
      'MOEX не прислал спецификацию инструмента GLDRUB_TOM',
    )
  })

  it('uses the midpoint when both sides of the order book are available', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          issResponse([{ SECID: 'SiZ6', BID: 85_026, OFFER: 85_028, LAST: 85_020 }]),
        ),
    )

    await expect(getMarketPrice('SiZ6')).resolves.toMatchObject({
      price: 85_027,
      source: 'MIDPOINT',
    })
  })

  it('uses LAST only when a complete order-book midpoint is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(issResponse([{ SECID: 'SiZ6', BID: 85_026, LAST: 85_020 }])),
    )

    await expect(getMarketPrice('SiZ6')).resolves.toMatchObject({
      price: 85_020,
      source: 'LAST',
    })
  })

  it('reports an unavailable price instead of using settlement or previous values', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            issResponse([{ SECID: 'SiZ6', BID: 85_026, SETTLEPRICE: 85_010, PREVPRICE: 84_900 }]),
          ),
        ),
    )

    await expect(getMarketPrice('SiZ6')).resolves.toMatchObject({
      price: null,
      source: 'unavailable',
    })
  })

  it('rejects an incomplete instrument specification', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          issResponse(
            [{ SECID: 'SiZ6', BID: 85_026, OFFER: 85_028 }],
            [{ SECID: 'SiZ6', MINSTEP: null, STEPPRICE: 1, LOTSIZE: 1 }],
          ),
        ),
    )

    await expect(getInstrumentSpecification('SiZ6', 'futures')).rejects.toThrow(
      'MOEX не прислал спецификацию инструмента SiZ6',
    )
  })
})
