import type {
  Asset,
  AssetType,
  CalculatedPortfolio,
  Future,
  IndicatorGraph,
  IndicatorType,
  OptionBoard,
  OptionBoardResponse,
  OptionSeries,
  PortfolioRequest,
  VolatilityPoint,
} from '@/types/moex'
import { appConfig } from '@/config'

import { queryString, requestSharedJson } from './http'

export type ApiRequestOptions = Pick<RequestInit, 'signal'>

function calculatePortfolio(
  payload: PortfolioRequest,
  options?: ApiRequestOptions,
): Promise<CalculatedPortfolio> {
  return requestSharedJson<CalculatedPortfolio>(`${appConfig.optionCalcBaseUrl}/portfolio/`, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    retries: 2,
  })
}

export const optionCalcApi = {
  searchAssets(query: string, assetType?: AssetType, options?: ApiRequestOptions) {
    return requestSharedJson<Asset[]>(
      `${appConfig.optionCalcBaseUrl}/assets${queryString({ query, asset_type: assetType })}`,
      { ...options, retries: 2 },
    )
  },

  getFutures(assetCode: string, expirationDate?: string, options?: ApiRequestOptions) {
    return requestSharedJson<Future[]>(
      `${appConfig.optionCalcBaseUrl}/assets/${encodeURIComponent(assetCode)}/futures${queryString({ expiration_date: expirationDate })}`,
      { ...options, retries: 2 },
    )
  },

  getSeries(assetCode: string, assetType?: AssetType, options?: ApiRequestOptions) {
    return requestSharedJson<OptionSeries[]>(
      `${appConfig.optionCalcBaseUrl}/assets/${encodeURIComponent(assetCode)}/optionseries${queryString({ asset_type: assetType })}`,
      { ...options, retries: 2 },
    )
  },

  getOptionBoard(
    assetCode: string,
    seriesCode: string,
    assetType?: AssetType,
    options?: ApiRequestOptions,
  ) {
    return requestSharedJson<OptionBoardResponse>(
      `${appConfig.optionCalcBaseUrl}/assets/${encodeURIComponent(assetCode)}/optionseries/${encodeURIComponent(seriesCode)}/optionboard${queryString({ asset_type: assetType })}`,
      { ...options, retries: 2 },
    ).then(
      (board): OptionBoard => ({
        rows: [
          ...board.call.map((row) => ({ ...row, option_type: 'call' as const })),
          ...board.put.map((row) => ({ ...row, option_type: 'put' as const })),
        ],
        valuationContext: board.valuation_context ?? null,
      }),
    )
  },

  getVolatilityGraph(
    assetCode: string,
    seriesCode: string,
    assetType?: AssetType,
    options?: ApiRequestOptions,
  ) {
    return requestSharedJson<VolatilityPoint[]>(
      `${appConfig.optionCalcBaseUrl}/assets/${encodeURIComponent(assetCode)}/optionseries/${encodeURIComponent(seriesCode)}/volatility_graph${queryString({ asset_type: assetType })}`,
      { ...options, retries: 2 },
    )
  },

  calculatePortfolio,

  getPortfolioGraph(
    indicator: IndicatorType,
    payload: PortfolioRequest,
    options?: ApiRequestOptions,
  ) {
    return requestSharedJson<IndicatorGraph>(
      `${appConfig.optionCalcBaseUrl}/portfolio/graph/${indicator}`,
      {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        retries: 2,
      },
    )
  },
}
