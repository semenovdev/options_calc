import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getInstrumentSpecification, getMarketPrice } from '@/api/iss'
import { optionCalcApi } from '@/api/optionCalc'
import type { OptionBoard } from '@/types/moex'

import {
  resolveBoardMarketPrice,
  resolveFutureMarketPrice,
  resolveLinearSpecification,
} from './backendMarketData'

vi.mock('@/api/iss', () => ({
  getInstrumentSpecification: vi.fn(),
  getMarketPrice: vi.fn(),
}))

vi.mock('@/api/optionCalc', () => ({
  optionCalcApi: {
    getFutures: vi.fn(),
    getOptionBoard: vi.fn(),
  },
}))

const getMarketPriceMock = vi.mocked(getMarketPrice)
const getInstrumentSpecificationMock = vi.mocked(getInstrumentSpecification)
const getFuturesMock = vi.mocked(optionCalcApi.getFutures)

beforeEach(() => vi.clearAllMocks())

describe('backend market data compatibility', () => {
  it('uses the Rust valuation context without requesting ISS', async () => {
    const board: OptionBoard = {
      rows: [],
      valuationContext: {
        mode: 'settlement',
        underlying_price: 85_031,
        underlying_secid: 'SiZ6',
        as_of: '2026-09-19T07:00:14Z',
      },
    }

    await expect(resolveBoardMarketPrice(board, 'SiZ6')).resolves.toEqual({
      secid: 'SiZ6',
      price: 85_031,
      updatedAt: '2026-09-19T07:00:14Z',
      source: 'SETTLEMENT',
    })
    expect(getMarketPriceMock).not.toHaveBeenCalled()
  })

  it('uses ISS for an official MOEX board without valuation_context', async () => {
    getMarketPriceMock.mockResolvedValue({
      secid: 'SiZ6',
      price: 85_020,
      source: 'LAST',
    })

    await expect(
      resolveBoardMarketPrice({ rows: [], valuationContext: null }, 'SiZ6'),
    ).resolves.toMatchObject({ price: 85_020 })
    expect(getMarketPriceMock).toHaveBeenCalledWith('SiZ6')
  })

  it('uses the Rust futures quote and specification without requesting ISS', async () => {
    getFuturesMock.mockResolvedValue([
      {
        futures_code: 'SiZ6',
        price: 85_011.5,
        price_source: 'midpoint',
        price_as_of: '2026-09-21T20:50:04Z',
        min_step: 1,
        step_price: 1,
        lot_size: 1,
      },
    ])

    await expect(resolveFutureMarketPrice('SI', 'SiZ6')).resolves.toMatchObject({
      price: 85_011.5,
      source: 'MIDPOINT',
    })
    await expect(resolveLinearSpecification('SI', 'SiZ6', 'futures')).resolves.toMatchObject({
      price: 85_011.5,
      minStep: 1,
      stepPrice: 1,
      lotSize: 1,
    })
    expect(getMarketPriceMock).not.toHaveBeenCalled()
    expect(getInstrumentSpecificationMock).not.toHaveBeenCalled()
  })

  it('uses ISS for an official MOEX future without specification fields', async () => {
    getFuturesMock.mockResolvedValue([{ futures_code: 'SiZ6', last: 85_020 }])
    getInstrumentSpecificationMock.mockResolvedValue({
      secid: 'SiZ6',
      price: 85_020,
      source: 'LAST',
      minStep: 1,
      stepPrice: 1,
      lotSize: 1,
    })

    await resolveLinearSpecification('SI', 'SiZ6', 'futures')
    expect(getInstrumentSpecificationMock).toHaveBeenCalledWith('SiZ6', 'futures')
  })

  it('does not hide an incomplete Rust specification behind ISS data', async () => {
    getFuturesMock.mockResolvedValue([
      {
        futures_code: 'SiZ6',
        price: 85_011.5,
        price_source: 'midpoint',
        min_step: null,
        step_price: 1,
        lot_size: 1,
      },
    ])

    await expect(resolveLinearSpecification('SI', 'SiZ6', 'futures')).rejects.toThrow(
      'Бэкенд прислал неполную спецификацию инструмента SiZ6',
    )
    expect(getInstrumentSpecificationMock).not.toHaveBeenCalled()
  })
})
