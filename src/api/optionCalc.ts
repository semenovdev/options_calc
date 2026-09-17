import type {
  Asset,
  AssetType,
  CalculatedPortfolio,
  Future,
  IndicatorGraph,
  IndicatorType,
  OptionBoardRow,
  OptionBoardResponse,
  OptionSeries,
  PortfolioRequest,
  VolatilityPoint,
} from '@/types/moex'

import { queryString, requestJson } from './http'

const BASE = '/moex-option-calc'
const portfolioRequests = new Map<string, Promise<CalculatedPortfolio>>()

function calculatePortfolio(payload: PortfolioRequest): Promise<CalculatedPortfolio> {
  const key = JSON.stringify(payload)
  const pending = portfolioRequests.get(key)
  if (pending) return pending

  const request = requestJson<CalculatedPortfolio>(`${BASE}/portfolio/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: key,
    retries: 2,
  }).finally(() => {
    if (portfolioRequests.get(key) === request) portfolioRequests.delete(key)
  })
  portfolioRequests.set(key, request)
  return request
}

export const optionCalcApi = {
  searchAssets(query: string, assetType?: AssetType) {
    return requestJson<Asset[]>(`${BASE}/assets${queryString({ query, asset_type: assetType })}`, {
      retries: 2,
    })
  },

  getFutures(assetCode: string, expirationDate?: string) {
    return requestJson<Future[]>(
      `${BASE}/assets/${encodeURIComponent(assetCode)}/futures${queryString({ expiration_date: expirationDate })}`,
      { retries: 2 },
    )
  },

  getSeries(assetCode: string, assetType?: AssetType) {
    return requestJson<OptionSeries[]>(
      `${BASE}/assets/${encodeURIComponent(assetCode)}/optionseries${queryString({ asset_type: assetType })}`,
      { retries: 2 },
    )
  },

  getOptionBoard(assetCode: string, seriesCode: string, assetType?: AssetType) {
    return requestJson<OptionBoardResponse>(
      `${BASE}/assets/${encodeURIComponent(assetCode)}/optionseries/${encodeURIComponent(seriesCode)}/optionboard${queryString({ asset_type: assetType })}`,
      { retries: 2 },
    ).then((board): OptionBoardRow[] => [
      ...board.call.map((row) => ({ ...row, option_type: 'call' as const })),
      ...board.put.map((row) => ({ ...row, option_type: 'put' as const })),
    ])
  },

  getVolatilityGraph(assetCode: string, seriesCode: string, assetType?: AssetType) {
    return requestJson<VolatilityPoint[]>(
      `${BASE}/assets/${encodeURIComponent(assetCode)}/optionseries/${encodeURIComponent(seriesCode)}/volatility_graph${queryString({ asset_type: assetType })}`,
      { retries: 2 },
    )
  },

  calculatePortfolio,

  getPortfolioGraph(indicator: IndicatorType, payload: PortfolioRequest) {
    return requestJson<IndicatorGraph>(`${BASE}/portfolio/graph/${indicator}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      retries: 2,
    })
  },
}
