import type {
  AssetType,
  CalculatedPortfolio,
  IndicatorGraph,
  IndicatorType,
  InstrumentType,
} from './moex'

export interface Position {
  id: string
  secid: string
  type: InstrumentType
  quantity: number
  price?: number
  nettedIm: boolean
  expirationDate?: string
  optionSeriesCode?: string
  underlyingFutureCode?: string
  strike?: number
  optionType?: 'call' | 'put'
  title?: string
}

export interface Strategy {
  id: string
  name: string
  assetCode: string
  assetType: AssetType
  positions: Position[]
  calculationDate: string
  volatilityShift: number
  marketPrice?: number | null
  updatedAt?: string
}

export interface CalculationState {
  portfolio: CalculatedPortfolio | null
  graphs: Partial<Record<IndicatorType, IndicatorGraph>>
  graphLoading: Partial<Record<IndicatorType, boolean>>
  loading: boolean
  error: string | null
  calculatedAt: string | null
}
