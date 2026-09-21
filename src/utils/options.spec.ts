import { describe, expect, it } from 'vitest'

import {
  indicatorValueAt,
  hasTheoreticalPrice,
  interpolateIndicator,
  isLiquidOption,
  niceAxisStep,
  optionMarketPrice,
  optionsAroundPrice,
  optionsBySpot,
  profitLossIntervals,
  spotDividerPosition,
  splitProfitLossArea,
} from './options'

describe('option helpers', () => {
  it('accepts only options with a tradable two-sided spread', () => {
    expect(isLiquidOption({ secid: 'LIQUID', strike: 100, bid: 9, offer: 11 })).toBe(true)
    expect(isLiquidOption({ secid: 'WIDE', strike: 100, bid: 1, offer: 10 })).toBe(false)
    expect(isLiquidOption({ secid: 'NO-OFFER', strike: 100, bid: 5, offer: 0 })).toBe(false)
  })

  it('uses the offer for a purchase and the bid for a sale', () => {
    expect(optionMarketPrice({ secid: 'THEORETICAL', strike: 100, theorprice: 12 })).toBeNull()
    expect(optionMarketPrice({ secid: 'QUOTED', strike: 100, bid: 10, offer: 12 }, 1)).toBe(12)
    expect(optionMarketPrice({ secid: 'QUOTED', strike: 100, bid: 10, offer: 12 }, -1)).toBe(10)
    expect(optionMarketPrice({ secid: 'NO-OFFER', strike: 100, bid: 10 }, 1)).toBeNull()
    expect(optionMarketPrice({ secid: 'NO-BID', strike: 100, offer: 12 }, -1)).toBeNull()
  })

  it('keeps zero-valued theoretical prices at expiration', () => {
    expect(hasTheoreticalPrice({ secid: 'ZERO', strike: 100, theorprice: 0 })).toBe(true)
    expect(hasTheoreticalPrice({ secid: 'POSITIVE', strike: 100, theorprice: 12 })).toBe(true)
    expect(hasTheoreticalPrice({ secid: 'MISSING', strike: 100 })).toBe(false)
    expect(hasTheoreticalPrice({ secid: 'INVALID', strike: 100, theorprice: -1 })).toBe(false)
  })

  it('keeps the requested number of strikes around ATM', () => {
    const options = [80, 90, 100, 110, 120].map((strike) => ({ secid: String(strike), strike }))
    expect(optionsAroundPrice(options, 103, 1, 2).map((option) => option.strike)).toEqual([
      90, 100, 110, 120,
    ])
  })

  it('limits strikes independently below and above spot', () => {
    const options = [70, 80, 90, 110, 120, 130].map((strike) => ({
      secid: String(strike),
      strike,
    }))
    expect(optionsBySpot(options, 100, 2).map((option) => option.strike)).toEqual([
      80, 90, 110, 120,
    ])
  })

  it('places the spot divider at either edge or inside a descending strike list', () => {
    const options = [110, 100, 90].map((strike) => ({ secid: String(strike), strike }))
    expect(spotDividerPosition(options, 120)).toBe(0)
    expect(spotDividerPosition(options, 105)).toBe(1)
    expect(spotDividerPosition(options, 80)).toBe(3)
  })

  it('uses readable dynamic axis steps', () => {
    expect(niceAxisStep(60)).toBe(10)
    expect(niceAxisStep(1_800)).toBe(500)
  })

  it('extends boundary values without introducing an artificial drop', () => {
    const points = [
      { underlying_price: 100, value: 1 },
      { underlying_price: 110, value: 11 },
    ]
    const result = interpolateIndicator(points, 90, 120, 4)
    expect(result.map((point) => point.value)).toEqual([1, 1, 11, 11])
  })

  it('interpolates a scenario value at the current market price', () => {
    expect(
      indicatorValueAt(
        [
          { underlying_price: 100, value: -10 },
          { underlying_price: 120, value: 30 },
        ],
        110,
      ),
    ).toBe(10)
  })

  it('splits profit and loss areas at the zero crossing', () => {
    const areas = splitProfitLossArea([
      { underlying_price: 100, value: -20 },
      { underlying_price: 120, value: 20 },
    ])
    expect(areas.profit).toEqual([
      { underlying_price: 100, value: 0 },
      { underlying_price: 110, value: 0 },
      { underlying_price: 120, value: 20 },
    ])
    expect(areas.loss).toEqual([
      { underlying_price: 100, value: -20 },
      { underlying_price: 110, value: 0 },
      { underlying_price: 120, value: 0 },
    ])
  })

  it('creates continuous payoff zones between break-even points', () => {
    expect(
      profitLossIntervals([
        { underlying_price: 80, value: -20 },
        { underlying_price: 100, value: 20 },
        { underlying_price: 120, value: -20 },
      ]),
    ).toEqual([
      { start: 80, end: 90, profit: false },
      { start: 90, end: 110, profit: true },
      { start: 110, end: 120, profit: false },
    ])
  })
})
