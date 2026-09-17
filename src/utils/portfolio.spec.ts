import { describe, expect, it } from 'vitest'

import type { Strategy } from '@/types/portfolio'
import { todayMoscow } from './format'
import { mergePosition, toPortfolioRequest } from './portfolio'

const strategy: Strategy = {
  id: 'strategy-1',
  name: 'Call spread',
  assetCode: 'SBER',
  assetType: 'share',
  calculationDate: '2026-09-17',
  volatilityShift: 2.5,
  positions: [
    {
      id: 'position-1',
      secid: 'SBER-OPTION',
      type: 'option',
      quantity: -2,
      price: 12.5,
      volatility: 28,
      nettedIm: true,
    },
  ],
}

describe('toPortfolioRequest', () => {
  it('maps UI positions to the MOEX portfolio contract', () => {
    expect(toPortfolioRequest(strategy)).toEqual({
      asset_code: 'SBER',
      asset_type: 'share',
      positions: [
        {
          secid: 'SBER-OPTION',
          type: 'option',
          quantity: -2,
          price: 12.5,
          volatility: 28,
          netted_im: true,
        },
      ],
      what_if: { date_of_calculation: '2026-09-17', delta_sigma: 2.5 },
    })
  })

  it('can calculate an isolated position', () => {
    const payload = toPortfolioRequest(strategy, [])
    expect(payload.positions).toEqual([])
  })

  it('omits what_if when neither scenario parameter is set', () => {
    const payload = toPortfolioRequest({
      ...strategy,
      calculationDate: '',
      volatilityShift: 0,
    })

    expect(payload).not.toHaveProperty('what_if')
  })

  it('adds the current date when volatility shift is set without a date', () => {
    const payload = toPortfolioRequest({
      ...strategy,
      calculationDate: '',
      volatilityShift: 3,
    })

    expect(payload.what_if).toEqual({
      date_of_calculation: todayMoscow(),
      delta_sigma: 3,
    })
  })
})

describe('mergePosition', () => {
  it('uses a quantity-weighted entry price when increasing a position', () => {
    const merged = mergePosition(strategy.positions[0]!, {
      secid: 'SBER-OPTION',
      type: 'option',
      quantity: -1,
      price: 20,
      volatility: 34,
      nettedIm: true,
    })
    expect(merged?.quantity).toBe(-3)
    expect(merged?.price).toBe(15)
    expect(merged?.volatility).toBe(30)
  })

  it('keeps the original entry price when partially closing', () => {
    const merged = mergePosition(strategy.positions[0]!, {
      secid: 'SBER-OPTION',
      type: 'option',
      quantity: 1,
      price: 20,
      nettedIm: true,
    })
    expect(merged?.quantity).toBe(-1)
    expect(merged?.price).toBe(12.5)
  })
})
