import type { InstrumentSpecification, InstrumentType, MarketPrice } from '@/types/moex'

import { queryString, requestJson } from './http'

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

function hasPrice(row: Record<string, unknown>): boolean {
  return ['LAST', 'MARKETPRICE', 'SETTLEPRICE', 'PREVPRICE'].some(
    (field) => finiteNumber(row[field]) !== null,
  )
}

function bestPriceRow(items: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return items.find((row) => finiteNumber(row.LAST) !== null) ?? items.find(hasPrice)
}

export async function getMarketPrice(secid: string): Promise<MarketPrice> {
  const columns = 'SECID,LAST,MARKETPRICE,SETTLEPRICE,PREVPRICE,UPDATETIME'
  const response = await requestJson<IssSecurityResponse>(
    `/moex-iss/securities/${encodeURIComponent(secid)}.json${queryString({
      'iss.meta': 'off',
      'iss.only': 'marketdata,securities',
      'marketdata.columns': columns,
      'securities.columns': columns,
    })}`,
  )
  let row = bestPriceRow([...rows(response.marketdata), ...rows(response.securities)]) ?? {}
  if (!hasPrice(row)) {
    const futuresResponse = await requestJson<IssSecurityResponse>(
      `/moex-iss/engines/futures/markets/forts/securities/${encodeURIComponent(secid)}.json${queryString(
        {
          'iss.meta': 'off',
          'iss.only': 'marketdata',
          'marketdata.columns': columns,
        },
      )}`,
    )
    row = bestPriceRow(rows(futuresResponse.marketdata)) ?? row
  }
  if (!hasPrice(row)) {
    const sharesResponse = await requestJson<IssSecurityResponse>(
      `/moex-iss/engines/stock/markets/shares/securities/${encodeURIComponent(secid)}.json${queryString(
        {
          'iss.meta': 'off',
          'iss.only': 'marketdata',
          'marketdata.columns': columns,
        },
      )}`,
    )
    row = bestPriceRow(rows(sharesResponse.marketdata)) ?? row
  }
  const candidates = ['LAST', 'MARKETPRICE', 'SETTLEPRICE', 'PREVPRICE'] as const
  const source = candidates.find((field) => finiteNumber(row[field]) !== null)
  return {
    secid,
    price: source ? finiteNumber(row[source]) : null,
    updatedAt: typeof row.UPDATETIME === 'string' ? row.UPDATETIME : null,
    source: source ?? 'unavailable',
  }
}

export async function getInstrumentSpecification(
  secid: string,
  type: Extract<InstrumentType, 'futures' | 'share'>,
): Promise<InstrumentSpecification> {
  const market = type === 'futures' ? 'futures/markets/forts' : 'stock/markets/shares'
  const columns = 'SECID,LAST,MARKETPRICE,SETTLEPRICE,PREVPRICE,UPDATETIME'
  const response = await requestJson<IssSecurityResponse>(
    `/moex-iss/engines/${market}/securities/${encodeURIComponent(secid)}.json${queryString({
      'iss.meta': 'off',
      'iss.only': 'marketdata,securities',
      'marketdata.columns': columns,
      'securities.columns': 'SECID,MINSTEP,STEPPRICE,LOTSIZE',
    })}`,
    { retries: 2 },
  )
  const marketRow = bestPriceRow(rows(response.marketdata)) ?? {}
  const securityRow = rows(response.securities)[0] ?? {}
  const source = (['LAST', 'MARKETPRICE', 'SETTLEPRICE', 'PREVPRICE'] as const).find(
    (field) => finiteNumber(marketRow[field]) !== null,
  )
  return {
    secid,
    price: source ? finiteNumber(marketRow[source]) : null,
    updatedAt: typeof marketRow.UPDATETIME === 'string' ? marketRow.UPDATETIME : null,
    source: source ?? 'unavailable',
    minStep: finiteNumber(securityRow.MINSTEP) ?? 1,
    stepPrice: finiteNumber(securityRow.STEPPRICE) ?? 1,
    lotSize: finiteNumber(securityRow.LOTSIZE) ?? 1,
  }
}
