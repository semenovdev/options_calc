import type { IndicatorPoint, OptionBoardRow } from '@/types/moex'

export function optionSpreadPercent(option: OptionBoardRow): number | null {
  if (!option.bid || !option.offer || option.bid <= 0 || option.offer <= 0) return null
  return ((option.offer - option.bid) / ((option.offer + option.bid) / 2)) * 100
}

export function isLiquidOption(option: OptionBoardRow, maximumSpread = 50): boolean {
  const spread = optionSpreadPercent(option)
  return spread !== null && spread >= 0 && spread <= maximumSpread
}

export function optionMarketPrice(option: OptionBoardRow): number | null {
  if (option.last && option.last > 0) return option.last
  if (option.bid && option.offer && option.bid > 0 && option.offer > 0) {
    return (option.bid + option.offer) / 2
  }
  return option.theorprice ?? null
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
