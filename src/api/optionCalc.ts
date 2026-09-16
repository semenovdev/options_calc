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

export const optionCalcApi = {
  searchAssets(query: string, assetType?: AssetType) {
    return requestJson<Asset[]>(`${BASE}/assets${queryString({ query, asset_type: assetType })}`)
  },

  getFutures(assetCode: string, expirationDate?: string) {
    return requestJson<Future[]>(
      `${BASE}/assets/${encodeURIComponent(assetCode)}/futures${queryString({ expiration_date: expirationDate })}`,
    )
  },

  getSeries(assetCode: string, assetType?: AssetType) {
    return requestJson<OptionSeries[]>(
      `${BASE}/assets/${encodeURIComponent(assetCode)}/optionseries${queryString({ asset_type: assetType })}`,
    )
  },

  getOptionBoard(assetCode: string, seriesCode: string, assetType?: AssetType) {
    return requestJson<OptionBoardResponse>(
      `${BASE}/assets/${encodeURIComponent(assetCode)}/optionseries/${encodeURIComponent(seriesCode)}/optionboard${queryString({ asset_type: assetType })}`,
    ).then((board): OptionBoardRow[] => [
      ...board.call.map((row) => ({ ...row, option_type: 'call' as const })),
      ...board.put.map((row) => ({ ...row, option_type: 'put' as const })),
    ])
  },

  getVolatilityGraph(assetCode: string, seriesCode: string, assetType?: AssetType) {
    return requestJson<VolatilityPoint[]>(
      `${BASE}/assets/${encodeURIComponent(assetCode)}/optionseries/${encodeURIComponent(seriesCode)}/volatility_graph${queryString({ asset_type: assetType })}`,
    )
  },

  calculatePortfolio(payload: PortfolioRequest) {
    return requestJson<CalculatedPortfolio>(`${BASE}/portfolio/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  },

  getPortfolioGraph(indicator: IndicatorType, payload: PortfolioRequest) {
    return requestJson<IndicatorGraph>(`${BASE}/portfolio/graph/${indicator}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  },
}
