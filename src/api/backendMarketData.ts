import { getInstrumentSpecification, getMarketPrice } from '@/api/iss'
import { optionCalcApi } from '@/api/optionCalc'
import type {
  AssetType,
  Future,
  InstrumentSpecification,
  MarketPrice,
  OptionBoard,
} from '@/types/moex'

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function futureMarketPrice(future: Future): MarketPrice | null {
  if (future.price !== undefined) {
    if (!positive(future.price)) {
      throw new Error(`Бэкенд не прислал текущую цену инструмента ${future.futures_code}`)
    }
    const source = future.price_source?.toLowerCase()
    if (source !== 'midpoint' && source !== 'last') {
      throw new Error(`Бэкенд прислал неподдерживаемый источник цены ${future.futures_code}`)
    }
    return {
      secid: future.futures_code,
      price: future.price,
      updatedAt: future.price_as_of ?? null,
      source: source === 'midpoint' ? 'MIDPOINT' : 'LAST',
    }
  }

  if (positive(future.last)) {
    return {
      secid: future.futures_code,
      price: future.last,
      updatedAt: null,
      source: 'LAST',
    }
  }
  return null
}

export function boardMarketPrice(board: OptionBoard): MarketPrice | null {
  const context = board.valuationContext
  if (!context) return null
  if (!positive(context.underlying_price) || !context.underlying_secid) {
    throw new Error('Бэкенд не прислал цену базового актива в valuation_context')
  }
  return {
    secid: context.underlying_secid,
    price: context.underlying_price,
    updatedAt: context.as_of ?? null,
    source: context.mode === 'market' ? 'MIDPOINT' : 'SETTLEMENT',
  }
}

export async function resolveBoardMarketPrice(
  board: OptionBoard,
  fallbackSecid: string,
): Promise<MarketPrice> {
  return boardMarketPrice(board) ?? getMarketPrice(fallbackSecid)
}

export async function resolveFutureMarketPrice(
  assetCode: string,
  secid: string,
): Promise<MarketPrice> {
  const futures = await optionCalcApi.getFutures(assetCode)
  const future = futures.find((item) => item.futures_code === secid)
  if (!future) throw new Error(`Бэкенд не вернул фьючерс ${secid}`)
  return futureMarketPrice(future) ?? getMarketPrice(secid)
}

export async function resolveLinearSpecification(
  assetCode: string,
  secid: string,
  type: 'futures' | 'share',
): Promise<InstrumentSpecification> {
  if (type === 'share') return getInstrumentSpecification(secid, type)

  const futures = await optionCalcApi.getFutures(assetCode)
  const future = futures.find((item) => item.futures_code === secid)
  if (!future) throw new Error(`Бэкенд не вернул фьючерс ${secid}`)
  const market = futureMarketPrice(future)
  const hasSpecificationFields =
    future.min_step !== undefined ||
    future.step_price !== undefined ||
    future.lot_size !== undefined
  if (!hasSpecificationFields) return getInstrumentSpecification(secid, type)
  if (
    !market ||
    !positive(future.min_step) ||
    !positive(future.step_price) ||
    !positive(future.lot_size)
  ) {
    throw new Error(`Бэкенд прислал неполную спецификацию инструмента ${secid}`)
  }
  return {
    ...market,
    price: market.price!,
    source: market.source as 'MIDPOINT' | 'LAST',
    minStep: future.min_step,
    stepPrice: future.step_price,
    lotSize: future.lot_size,
  }
}

export async function resolveUnderlyingMarketPrice(
  assetCode: string,
  assetType: AssetType,
  secid: string,
  optionSeriesCode?: string,
): Promise<MarketPrice> {
  if (optionSeriesCode) {
    const board = await optionCalcApi.getOptionBoard(assetCode, optionSeriesCode, assetType)
    return resolveBoardMarketPrice(board, secid)
  }
  if (assetType === 'futures') return resolveFutureMarketPrice(assetCode, secid)
  return getMarketPrice(secid)
}
