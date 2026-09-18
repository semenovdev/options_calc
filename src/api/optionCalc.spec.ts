import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PortfolioRequest } from '@/types/moex'

import { optionCalcApi } from './optionCalc'

afterEach(() => vi.unstubAllGlobals())

describe('optionCalcApi', () => {
  it('uses the configured Option Calc API base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await optionCalcApi.searchAssets('Si', 'futures')

    expect(fetchMock).toHaveBeenCalledWith(
      '/moex-option-calc/assets?query=Si&asset_type=futures',
      expect.any(Object),
    )
  })

  it('coalesces simultaneous portfolio calculations with the same payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ positions: [], total: {}, initial_margin: 100 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const payload: PortfolioRequest = {
      asset_code: 'RTS',
      asset_type: 'futures',
      positions: [
        {
          secid: 'RI82500BI6D',
          type: 'option',
          quantity: 1,
          price: 2850,
          volatility: 34.76,
          netted_im: true,
        },
      ],
    }

    const [first, second] = await Promise.all([
      optionCalcApi.calculatePortfolio(payload),
      optionCalcApi.calculatePortfolio(payload),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
  })
})
