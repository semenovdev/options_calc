import { describe, expect, it } from 'vitest'

import type { Strategy } from '@/types/portfolio'
import { toPortfolioRequest } from './portfolio'

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
})
