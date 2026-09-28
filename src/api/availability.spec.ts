import { describe, expect, it } from 'vitest'

import { marketDataWarning } from './availability'
import { MoexApiError } from './http'

const missing =
  'Neither market nor settlement valuation context is complete: market: missing market price for S2170CX6; settlement: missing settlement price for SLVRUB_TOM'

describe('market data availability', () => {
  it.each([
    missing,
    'missing market price for S2170CX6',
    'missing settlement price for SLVRUB_TOM',
    'volatility unavailable for series for S2175CL6',
  ])('recognizes absent inputs: %s', (message) => {
    expect(
      marketDataWarning(new MoexApiError(message, 503, { code: 'LIVE_DATA_UNAVAILABLE' })),
    ).toContain('котировок')
  })

  it.each([
    'Neither market nor settlement valuation context is complete',
    'Neither market nor settlement valuation context is complete: market: IV_PRICE_BOUNDS; settlement: missing settlement price for SMLT',
    'Neither market nor settlement valuation context is complete: market: missing market price for SMLT; settlement: invalid model',
    'reference interest rate unavailable',
    'invalid curve',
    'ISS timeout',
  ])('does not hide an unknown or invalid input: %s', (message) => {
    expect(
      marketDataWarning(new MoexApiError(message, 503, { code: 'LIVE_DATA_UNAVAILABLE' })),
    ).toBeNull()
  })

  it('does not infer availability from HTTP status or a legacy error string alone', () => {
    expect(marketDataWarning(new MoexApiError(missing, 503))).toBeNull()
    expect(marketDataWarning(new Error(missing))).toBeNull()
    expect(marketDataWarning(new MoexApiError(missing, 400, { code: 'INVALID_INPUT' }))).toBeNull()
  })
})
