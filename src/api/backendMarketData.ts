import { getInstrumentSpecification, getMarketPrice } from '@/api/iss'
import { optionCalcApi, type ApiRequestOptions } from '@/api/optionCalc'
import { appConfig } from '@/config'
import type {
  AssetType,
  Future,
  InstrumentSpecification,
  LinearInstrumentType,
  MarketPrice,
  OptionBoard,
  ValuationContext,
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

export function valuationMarketPrice(context?: ValuationContext | null): MarketPrice | null {
  if (context === undefined) return null
  if (!context || !positive(context.underlying_price) || !context.underlying_secid) {
    throw new Error('Бэкенд не прислал цену базового актива в valuation_context')
  }
  return {
    secid: context.underlying_secid,
    price: context.underlying_price,
    updatedAt: context.as_of ?? null,
    source: context.mode === 'market' ? 'MIDPOINT' : 'SETTLEMENT',
  }
}

export function boardMarketPrice(board: OptionBoard): MarketPrice | null {
  return board.valuationContext ? valuationMarketPrice(board.valuationContext) : null
}

export async function resolveBoardMarketPrice(
  board: OptionBoard,
  fallbackSecid: string,
  options?: ApiRequestOptions,
): Promise<MarketPrice> {
  const market = boardMarketPrice(board)
  if (market) return market
  if (appConfig.backend === 'rust') throw new Error('Бэкенд не прислал valuation_context доски')
  return getMarketPrice(fallbackSecid, options)
}

export async function resolveInstrumentMarketPrice(
  secid: string,
  options?: ApiRequestOptions,
  type?: LinearInstrumentType,
): Promise<MarketPrice> {
  if (appConfig.backend !== 'rust') {
    if (type === 'commodity' || type === 'currency')
      return getInstrumentSpecification(secid, type, options)
    return getMarketPrice(secid, options)
  }
  const instrument = await optionCalcApi.getInstrument(secid, options)
  const market = futureMarketPrice({ ...instrument, futures_code: instrument.secid })
  if (!market) throw new Error(`Бэкенд не прислал текущую цену инструмента ${secid}`)
  return market
}

export async function resolveFutureMarketPrice(
  assetCode: string,
  secid: string,
  options?: ApiRequestOptions,
): Promise<MarketPrice> {
  const futures = await optionCalcApi.getFutures(assetCode, undefined, options)
  const future = futures.find((item) => item.futures_code === secid)
  if (!future) throw new Error(`Бэкенд не вернул фьючерс ${secid}`)
  const market = futureMarketPrice(future)
  if (market) return market
  if (appConfig.backend === 'rust')
    throw new Error(`Бэкенд не прислал текущую цену инструмента ${secid}`)
  return getMarketPrice(secid, options)
}

export async function resolveLinearSpecification(
  assetCode: string,
  secid: string,
  type: LinearInstrumentType,
  options?: ApiRequestOptions,
): Promise<InstrumentSpecification> {
  if (type !== 'futures' && appConfig.backend !== 'rust')
    return getInstrumentSpecification(secid, type, options)

  const futures =
    type !== 'futures'
      ? [
          await optionCalcApi
            .getInstrument(secid, options)
            .then((item) => ({ ...item, futures_code: item.secid })),
        ]
      : await optionCalcApi.getFutures(assetCode, undefined, options)
  const future = futures.find((item) => item.futures_code === secid)
  if (!future) throw new Error(`Бэкенд не вернул фьючерс ${secid}`)
  const market = futureMarketPrice(future)
  const hasSpecificationFields =
    future.min_step !== undefined ||
    future.step_price !== undefined ||
    future.lot_size !== undefined
  if (!hasSpecificationFields && appConfig.backend !== 'rust')
    return getInstrumentSpecification(secid, type, options)
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
  options?: ApiRequestOptions,
): Promise<MarketPrice> {
  if (optionSeriesCode) {
    const board = await optionCalcApi.getOptionBoard(
      assetCode,
      optionSeriesCode,
      assetType,
      options,
    )
    return resolveBoardMarketPrice(board, secid, options)
  }
  if (assetType === 'futures') return resolveFutureMarketPrice(assetCode, secid, options)
  return resolveInstrumentMarketPrice(secid, options)
}
