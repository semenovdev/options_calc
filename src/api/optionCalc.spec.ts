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

  it('normalizes Rust and official MOEX option boards', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            call: [{ secid: 'CALL', strike: 85_000 }],
            put: [{ secid: 'PUT', strike: 85_000 }],
            valuation_context: {
              mode: 'settlement',
              underlying_price: 85_031,
              underlying_secid: 'SiZ6',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            call: [{ secid: 'CALL', strike: 85_000 }],
            put: [{ secid: 'PUT', strike: 85_000 }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const rust = await optionCalcApi.getOptionBoard('SI', 'SERIES', 'futures')
    const moex = await optionCalcApi.getOptionBoard('SI', 'SERIES', 'futures')

    expect(rust.rows.map((row) => row.option_type)).toEqual(['call', 'put'])
    expect(rust.valuationContext?.underlying_price).toBe(85_031)
    expect(moex.rows).toHaveLength(2)
    expect(moex.valuationContext).toBeNull()
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

  it.each(['market', 'settlement', null])(
    'delivers smile context %s to every subscriber',
    async (mode) => {
      const headers = new Headers({ 'Content-Type': 'application/json' })
      if (mode) headers.set('x-valuation-mode', mode)
      const fetchMock = vi.fn(async () => new Response('[]', { headers }))
      vi.stubGlobal('fetch', fetchMock)
      const first = vi.fn()
      const second = vi.fn()
      await Promise.all([
        optionCalcApi.getVolatilityGraph('SI', 'SERIES', 'futures', { onValuationMode: first }),
        optionCalcApi.getVolatilityGraph('SI', 'SERIES', 'futures', { onValuationMode: second }),
      ])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(first).toHaveBeenCalledWith(mode)
      expect(second).toHaveBeenCalledWith(mode)
    },
  )

  it.each(['board', 'futures', 'series', 'smile'] as const)(
    'shares overlapping %s reads and refreshes on the next call',
    async (kind) => {
      const fetchMock = vi.fn(async () => {
        const body = kind === 'board' ? { call: [], put: [] } : []
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
      vi.stubGlobal('fetch', fetchMock)
      const load = () => {
        if (kind === 'board') return optionCalcApi.getOptionBoard('SI', 'SERIES', 'futures')
        if (kind === 'futures') return optionCalcApi.getFutures('SI')
        if (kind === 'series') return optionCalcApi.getSeries('SI', 'futures')
        return optionCalcApi.getVolatilityGraph('SI', 'SERIES', 'futures')
      }
      await Promise.all([load(), load()])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await load()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    },
  )
})
