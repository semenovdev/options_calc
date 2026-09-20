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
import { appConfig } from '@/config'

import { queryString, requestJson } from './http'

const portfolioRequests = new Map<string, Promise<CalculatedPortfolio>>()

function calculatePortfolio(payload: PortfolioRequest): Promise<CalculatedPortfolio> {
  const key = JSON.stringify(payload)
  const pending = portfolioRequests.get(key)
  if (pending) return pending

  const request = requestJson<CalculatedPortfolio>(`${appConfig.optionCalcBaseUrl}/portfolio/`, {
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
    return requestJson<Asset[]>(
      `${appConfig.optionCalcBaseUrl}/assets${queryString({ query, asset_type: assetType })}`,
      { retries: 2 },
    )
  },

  getFutures(assetCode: string, expirationDate?: string) {
    return requestJson<Future[]>(
      `${appConfig.optionCalcBaseUrl}/assets/${encodeURIComponent(assetCode)}/futures${queryString({ expiration_date: expirationDate })}`,
      { retries: 2 },
    )
  },

  getSeries(assetCode: string, assetType?: AssetType) {
    return requestJson<OptionSeries[]>(
      `${appConfig.optionCalcBaseUrl}/assets/${encodeURIComponent(assetCode)}/optionseries${queryString({ asset_type: assetType })}`,
      { retries: 2 },
    )
  },

  getOptionBoard(assetCode: string, seriesCode: string, assetType?: AssetType) {
    return requestJson<OptionBoardResponse>(
      `${appConfig.optionCalcBaseUrl}/assets/${encodeURIComponent(assetCode)}/optionseries/${encodeURIComponent(seriesCode)}/optionboard${queryString({ asset_type: assetType })}`,
      { retries: 2 },
    ).then((board): OptionBoardRow[] => [
      ...board.call.map((row) => ({ ...row, option_type: 'call' as const })),
      ...board.put.map((row) => ({ ...row, option_type: 'put' as const })),
    ])
  },

  getVolatilityGraph(assetCode: string, seriesCode: string, assetType?: AssetType) {
    return requestJson<VolatilityPoint[]>(
      `${appConfig.optionCalcBaseUrl}/assets/${encodeURIComponent(assetCode)}/optionseries/${encodeURIComponent(seriesCode)}/volatility_graph${queryString({ asset_type: assetType })}`,
      { retries: 2 },
    )
  },

  calculatePortfolio,

  getPortfolioGraph(indicator: IndicatorType, payload: PortfolioRequest) {
    return requestJson<IndicatorGraph>(
      `${appConfig.optionCalcBaseUrl}/portfolio/graph/${indicator}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        retries: 2,
      },
    )
  },
}
