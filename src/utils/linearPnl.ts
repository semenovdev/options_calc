import type { IndicatorGraph, IndicatorPoint, InstrumentSpecification } from '@/types/moex'
import type { Position } from '@/types/portfolio'

export interface LinearPosition {
  position: Position
  specification: InstrumentSpecification
}

export function linearMultiplier(item: LinearPosition): number {
  return item.position.type === 'futures'
    ? item.specification.stepPrice / item.specification.minStep
    : 1
}

export function linearPnl(item: LinearPosition, marketPrice: number): number {
  const entryPrice = item.position.price ?? item.specification.price ?? marketPrice
  return (marketPrice - entryPrice) * item.position.quantity * linearMultiplier(item)
}

function grid(spot: number): IndicatorPoint[] {
  const minimum = Math.max(0, spot * 0.75)
  const step = (spot * 0.5) / 120
  return Array.from({ length: 121 }, (_, index) => ({
    underlying_price: minimum + step * index,
    value: 0,
  }))
}

export function addLinearPositionsToGraph(
  graph: IndicatorGraph | undefined,
  positions: LinearPosition[],
  indicator: string,
  spot: number,
): IndicatorGraph {
  const adjust = (points: IndicatorPoint[] | null | undefined): IndicatorPoint[] => {
    const source = points?.length ? points : grid(spot)
    return source.map((point) => ({
      ...point,
      value:
        point.value +
        positions.reduce((total, item) => {
          if (indicator === 'profit_and_loss')
            return total + linearPnl(item, point.underlying_price)
          if (indicator === 'delta') return total + item.position.quantity * linearMultiplier(item)
          return total
        }, 0),
    }))
  }
  return {
    now: adjust(graph?.now),
    on_expiration: adjust(graph?.on_expiration),
    on_what_if: graph?.on_what_if ? adjust(graph.on_what_if) : null,
  }
}
