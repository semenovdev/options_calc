import { describe, expect, it } from 'vitest'

import {
  indicatorValueAt,
  interpolateIndicator,
  isLiquidOption,
  niceAxisStep,
  optionsAroundPrice,
} from './options'

describe('option helpers', () => {
  it('accepts only options with a tradable two-sided spread', () => {
    expect(isLiquidOption({ secid: 'LIQUID', strike: 100, bid: 9, offer: 11 })).toBe(true)
    expect(isLiquidOption({ secid: 'WIDE', strike: 100, bid: 1, offer: 10 })).toBe(false)
    expect(isLiquidOption({ secid: 'NO-OFFER', strike: 100, bid: 5, offer: 0 })).toBe(false)
  })

  it('keeps the requested number of strikes around ATM', () => {
    const options = [80, 90, 100, 110, 120].map((strike) => ({ secid: String(strike), strike }))
    expect(optionsAroundPrice(options, 103, 1, 2).map((option) => option.strike)).toEqual([
      90, 100, 110, 120,
    ])
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
})
