import type { MarketPrice } from '@/types/moex'

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
  const number = Number(value)
  return Number.isFinite(number) ? number : null
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
  const row = rows(response.marketdata)[0] ?? rows(response.securities)[0] ?? {}
  const candidates = ['LAST', 'MARKETPRICE', 'SETTLEPRICE', 'PREVPRICE'] as const
  const source = candidates.find((field) => finiteNumber(row[field]) !== null)
  return {
    secid,
    price: source ? finiteNumber(row[source]) : null,
    updatedAt: typeof row.UPDATETIME === 'string' ? row.UPDATETIME : null,
    source: source ?? 'unavailable',
  }
}
