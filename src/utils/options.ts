import type { IndicatorPoint, OptionBoardRow } from '@/types/moex'

export function optionReferencePrice(option: OptionBoardRow): {
  price: number | null
  label: string
} {
  const valid = (price: number | null | undefined): price is number =>
    price != null && Number.isFinite(price) && price >= 0
  if (valid(option.settlement_price)) {
    return { price: option.settlement_price, label: 'Расчёт (поставщик)' }
  }
  // The official legacy board exposes its supplied calculation as theorprice.
  if (!('model_price' in option) && !('settlement_price' in option)) {
    return {
      price: valid(option.theorprice) ? option.theorprice : null,
      label: 'Расчёт (поставщик)',
    }
  }
  const label =
    option.underlying_source === 'market'
      ? 'Модельная (рынок)'
      : option.underlying_source === 'settlement'
        ? 'Модельная (клиринг)'
        : 'Модельная'
  return { price: valid(option.model_price) ? option.model_price : null, label }
}

export function optionSpreadPercent(option: OptionBoardRow): number | null {
  if (!option.bid || !option.offer || option.bid <= 0 || option.offer <= 0) return null
  return ((option.offer - option.bid) / ((option.offer + option.bid) / 2)) * 100
}

export function isLiquidOption(option: OptionBoardRow, maximumSpread = 50): boolean {
  const spread = optionSpreadPercent(option)
  return spread !== null && spread >= 0 && spread <= maximumSpread
}

export function hasTheoreticalPrice(option: OptionBoardRow): boolean {
  return (
    option.theorprice !== null &&
    option.theorprice !== undefined &&
    Number.isFinite(option.theorprice) &&
    option.theorprice >= 0
  )
}

export function optionMarketPrice(option: OptionBoardRow, quantity = 1): number | null {
  if (quantity > 0 && option.offer && option.offer > 0) return option.offer
  if (quantity < 0 && option.bid && option.bid > 0) return option.bid
  return null
}

export function optionsAroundPrice(
  options: OptionBoardRow[],
  underlyingPrice: number | null,
  below: number,
  above: number,
): OptionBoardRow[] {
  const sorted = [...options].sort((left, right) => left.strike - right.strike)
  if (!sorted.length || !underlyingPrice) return sorted.slice(0, below + above + 1)
  const atmIndex = sorted.reduce(
    (best, option, index) =>
      Math.abs(option.strike - underlyingPrice) < Math.abs(sorted[best]!.strike - underlyingPrice)
        ? index
        : best,
    0,
  )
  return sorted.slice(Math.max(0, atmIndex - below), atmIndex + above + 1)
}

export function optionsBySpot(
  options: OptionBoardRow[],
  underlyingPrice: number | null,
  limitPerSide: number,
): OptionBoardRow[] {
  const sorted = [...options].sort((left, right) => left.strike - right.strike)
  const limit = Math.max(0, Math.floor(limitPerSide))
  if (!sorted.length || !underlyingPrice) return sorted.slice(0, limit * 2)

  const below = sorted.filter((option) => option.strike <= underlyingPrice).slice(-limit)
  const above = sorted.filter((option) => option.strike > underlyingPrice).slice(0, limit)
  return [...below, ...above]
}

export function spotDividerPosition(
  options: OptionBoardRow[],
  underlyingPrice: number | null,
): number {
  if (!options.length || !underlyingPrice) return -1
  const firstBelowSpot = options.findIndex((option) => option.strike <= underlyingPrice)
  return firstBelowSpot === -1 ? options.length : firstBelowSpot
}

export function niceAxisStep(range: number, targetSplits = 6): number {
  if (!Number.isFinite(range) || range <= 0) return 1
  const rough = range / targetSplits
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / magnitude
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return nice * magnitude
}

export function interpolateIndicator(
  points: IndicatorPoint[],
  minimum: number,
  maximum: number,
  samples = 121,
): IndicatorPoint[] {
  const sorted = [...points].sort((left, right) => left.underlying_price - right.underlying_price)
  if (sorted.length < 2 || maximum <= minimum) return sorted
  const step = (maximum - minimum) / (samples - 1)
  return Array.from({ length: samples }, (_, index) => {
    const price = minimum + step * index
    const rightIndex = sorted.findIndex((point) => point.underlying_price >= price)
    if (rightIndex === -1) {
      return { underlying_price: price, value: sorted[sorted.length - 1]!.value }
    }
    if (rightIndex === 0) return { underlying_price: price, value: sorted[0]!.value }
    const left = sorted[rightIndex - 1]!
    const right = sorted[rightIndex]!
    const ratio = (price - left.underlying_price) / (right.underlying_price - left.underlying_price)
    return { underlying_price: price, value: left.value + (right.value - left.value) * ratio }
  })
}

export function indicatorValueAt(points: IndicatorPoint[], price: number): number | null {
  if (!points.length || !Number.isFinite(price)) return null
  return interpolateIndicator(points, price, price + 1, 2)[0]?.value ?? null
}

export function splitProfitLossArea(points: IndicatorPoint[]): {
  profit: IndicatorPoint[]
  loss: IndicatorPoint[]
} {
  const profit: IndicatorPoint[] = []
  const loss: IndicatorPoint[] = []

  points.forEach((point, index) => {
    const previous = points[index - 1]
    if (previous && previous.value * point.value < 0) {
      const ratio = -previous.value / (point.value - previous.value)
      const crossing = {
        underlying_price:
          previous.underlying_price + ratio * (point.underlying_price - previous.underlying_price),
        value: 0,
      }
      profit.push(crossing)
      loss.push(crossing)
    }
    profit.push({ ...point, value: Math.max(0, point.value) })
    loss.push({ ...point, value: Math.min(0, point.value) })
  })

  return { profit, loss }
}

export interface ProfitLossInterval {
  start: number
  end: number
  profit: boolean
}

export function profitLossIntervals(points: IndicatorPoint[]): ProfitLossInterval[] {
  const intervals: ProfitLossInterval[] = []
  const append = (start: number, end: number, profit: boolean) => {
    if (end <= start) return
    const previous = intervals[intervals.length - 1]
    if (previous?.profit === profit && previous.end === start) previous.end = end
    else intervals.push({ start, end, profit })
  }

  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]!
    const right = points[index]!
    if (left.value * right.value < 0) {
      const ratio = -left.value / (right.value - left.value)
      const crossing =
        left.underlying_price + ratio * (right.underlying_price - left.underlying_price)
      append(left.underlying_price, crossing, left.value >= 0)
      append(crossing, right.underlying_price, right.value >= 0)
    } else {
      append(left.underlying_price, right.underlying_price, (left.value + right.value) / 2 >= 0)
    }
  }
  return intervals
}
