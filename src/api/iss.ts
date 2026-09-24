import type { InstrumentSpecification, LinearInstrumentType, MarketPrice } from '@/types/moex'

import type { ApiRequestOptions } from './optionCalc'
import { queryString, requestSharedJson } from './http'

interface IssBlock {
  columns: string[]
  data: unknown[][]
}

interface IssSecurityResponse {
  marketdata?: IssBlock
  securities?: IssBlock
}

function rows(block?: IssBlock): Record<string, unknown>[] {
  if (!block) return []
  return block.data.map((values) =>
    Object.fromEntries(block.columns.map((column, index) => [column, values[index]])),
  )
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value)
  return number !== null && number > 0 ? number : null
}

function currentPrice(row: Record<string, unknown>): {
  price: number | null
  source: 'MIDPOINT' | 'LAST' | 'unavailable'
} {
  const bid = positiveNumber(row.BID)
  const offer = positiveNumber(row.OFFER)
  if (bid !== null && offer !== null && bid <= offer) {
    return { price: (bid + offer) / 2, source: 'MIDPOINT' }
  }
  const last = positiveNumber(row.LAST)
  return last === null ? { price: null, source: 'unavailable' } : { price: last, source: 'LAST' }
}

function hasPrice(row: Record<string, unknown>): boolean {
  return currentPrice(row).price !== null
}

function bestPriceRow(items: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return items.find(hasPrice)
}

export async function getMarketPrice(
  secid: string,
  options?: ApiRequestOptions,
): Promise<MarketPrice> {
  const columns = 'SECID,BID,OFFER,LAST,UPDATETIME'
  const response = await requestSharedJson<IssSecurityResponse>(
    `/moex-iss/securities/${encodeURIComponent(secid)}.json${queryString({
      'iss.meta': 'off',
      'iss.only': 'marketdata,securities',
      'marketdata.columns': columns,
      'securities.columns': columns,
    })}`,
    options,
  )
  let row = bestPriceRow([...rows(response.marketdata), ...rows(response.securities)]) ?? {}
  if (!hasPrice(row)) {
    const futuresResponse = await requestSharedJson<IssSecurityResponse>(
      `/moex-iss/engines/futures/markets/forts/securities/${encodeURIComponent(secid)}.json${queryString(
        {
          'iss.meta': 'off',
          'iss.only': 'marketdata',
          'marketdata.columns': columns,
        },
      )}`,
      options,
    )
    row = bestPriceRow(rows(futuresResponse.marketdata)) ?? row
  }
  if (!hasPrice(row)) {
    const sharesResponse = await requestSharedJson<IssSecurityResponse>(
      `/moex-iss/engines/stock/markets/shares/securities/${encodeURIComponent(secid)}.json${queryString(
        {
          'iss.meta': 'off',
          'iss.only': 'marketdata',
          'marketdata.columns': columns,
        },
      )}`,
      options,
    )
    row = bestPriceRow(rows(sharesResponse.marketdata)) ?? row
  }
  const market = currentPrice(row)
  return {
    secid,
    price: market.price,
    updatedAt: typeof row.UPDATETIME === 'string' ? row.UPDATETIME : null,
    source: market.source,
  }
}

export async function getInstrumentSpecification(
  secid: string,
  type: LinearInstrumentType,
  options?: ApiRequestOptions,
): Promise<InstrumentSpecification> {
  const market =
    type === 'futures'
      ? 'futures/markets/forts'
      : type === 'share'
        ? 'stock/markets/shares'
        : 'currency/markets/selt/boards/CETS'
  const columns = 'SECID,BID,OFFER,LAST,UPDATETIME'
  const response = await requestSharedJson<IssSecurityResponse>(
    `/moex-iss/engines/${market}/securities/${encodeURIComponent(secid)}.json${queryString({
      'iss.meta': 'off',
      'iss.only': 'marketdata,securities',
      'marketdata.columns': columns,
      'securities.columns': 'SECID,MINSTEP,STEPPRICE,LOTSIZE',
    })}`,
    { ...options, retries: 2 },
  )
  const marketRow = bestPriceRow(rows(response.marketdata))
  const securityRow = rows(response.securities)[0]
  if (!marketRow || !securityRow) throw new Error(`Нет данных по инструменту ${secid}`)
  const marketPrice = currentPrice(marketRow)
  const minStep = positiveNumber(securityRow.MINSTEP)
  const lotSize = positiveNumber(securityRow.LOTSIZE)
  const stepPrice =
    type === 'futures'
      ? positiveNumber(securityRow.STEPPRICE)
      : minStep !== null && lotSize !== null
        ? minStep * lotSize
        : null
  if (marketPrice.price === null || marketPrice.source === 'unavailable') {
    throw new Error(`Нет текущей цены инструмента ${secid}`)
  }
  if (minStep === null || stepPrice === null || lotSize === null) {
    throw new Error(`MOEX не прислал спецификацию инструмента ${secid}`)
  }
  return {
    secid,
    price: marketPrice.price,
    updatedAt: typeof marketRow.UPDATETIME === 'string' ? marketRow.UPDATETIME : null,
    source: marketPrice.source,
    minStep,
    stepPrice,
    lotSize,
  }
}
