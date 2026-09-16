import { describe, expect, it } from 'vitest'

import type { InstrumentSpecification } from '@/types/moex'
import type { Position } from '@/types/portfolio'

import { addLinearPositionsToGraph, linearPnl, type LinearPosition } from './linearPnl'

function item(type: 'futures' | 'share', overrides: Partial<Position> = {}): LinearPosition {
  const position: Position = {
    id: 'position-1',
    secid: 'TEST',
    type,
    quantity: 2,
    price: 100,
    nettedIm: true,
    ...overrides,
  }
  const specification: InstrumentSpecification = {
    secid: 'TEST',
    price: 110,
    source: 'LAST',
    minStep: 5,
    stepPrice: 10,
    lotSize: 10,
  }
  return { position, specification }
}

describe('linear P&L', () => {
  it('uses the MOEX step value for futures', () => {
    expect(linearPnl(item('futures'), 110)).toBe(40)
  })

  it('treats share quantity as a number of shares', () => {
    expect(linearPnl(item('share'), 110)).toBe(20)
  })

  it('adds a linear component to every graph point', () => {
    const graph = addLinearPositionsToGraph(
      { now: [{ underlying_price: 110, value: 5 }], on_expiration: [] },
      [item('futures')],
      'profit_and_loss',
      110,
    )
    expect(graph.now[0]?.value).toBe(45)
    expect(graph.on_expiration).toHaveLength(121)
  })

  it('tilts an option P&L profile after adding a futures hedge', () => {
    const optionProfile = {
      now: [
        { underlying_price: 90, value: 100 },
        { underlying_price: 110, value: 100 },
      ],
      on_expiration: [],
    }
    const hedged = addLinearPositionsToGraph(
      optionProfile,
      [item('futures', { quantity: 3, price: 100 })],
      'profit_and_loss',
      100,
    )

    expect(hedged.now[0]?.value).toBe(40)
    expect(hedged.now[1]?.value).toBe(160)
  })
})
