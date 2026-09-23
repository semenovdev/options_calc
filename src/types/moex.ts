export type AssetType = 'commodity' | 'currency' | 'futures' | 'index' | 'share'
export type InstrumentType = 'currency' | 'commodity' | 'futures' | 'option' | 'share'
export type IndicatorType = 'profit_and_loss' | 'delta' | 'gamma' | 'vega' | 'theta' | 'rho'
export type OptionType = 'call' | 'put'

export interface Asset {
  asset_code: string
  title: string
  asset_type: AssetType
  asset_subtype?: AssetType | null
}

export interface Future {
  futures_code: string
  asset_code?: string
  asset_type?: AssetType
  shortname?: string
  expiration_date?: string
  last?: number | null
  settleprice?: number | null
  bid?: number | null
  offer?: number | null
  midpoint?: number | null
  settlement_price?: number | null
  price?: number | null
  price_source?: string | null
  price_as_of?: string | null
  currency?: string | null
  min_step?: number | null
  step_price?: number | null
  lot_size?: number | null
  multiplier?: number | null
}

export interface OptionSeriesTotals {
  volume_rub?: number
  volume_contracts?: number
  openposition?: number
  oichange?: number
}

export interface OptionSeries {
  optionseries_code: string
  asset_code: string
  asset_type: AssetType
  futures_code?: string | null
  series_type?: string
  expiration_date: string
  central_strike?: number
  call?: OptionSeriesTotals
  put?: OptionSeriesTotals
  updatetime?: string
}

export interface OptionBoardRow {
  secid: string
  option_type?: OptionType
  strike: number
  expiration_date?: string
  theorprice?: number | null
  theorprice_rub?: number | null
  last?: number | null
  offer?: number | null
  bid?: number | null
  numtrades?: number | null
  volatility?: number | null
  delta?: number | null
  gamma?: number | null
  vega?: number | null
  theta?: number | null
  rho?: number | null
  intrinsic_value?: number | null
  timed_value?: number | null
}

export interface OptionBoardResponse {
  call: OptionBoardRow[]
  put: OptionBoardRow[]
  pricing_mode?: string
  valuation_context?: ValuationContext | null
}

export interface ValuationContext {
  mode?: string | null
  underlying_price?: number | null
  underlying_secid?: string | null
  as_of?: string | null
}

export interface OptionBoard {
  rows: OptionBoardRow[]
  valuationContext: ValuationContext | null
}

export interface VolatilityPoint {
  strike: number
  volatility: number
}

export interface PortfolioPositionRequest {
  secid: string
  type: InstrumentType
  quantity: number
  price?: number
  netted_im?: boolean
}

export interface PortfolioRequest {
  asset_code: string
  asset_type?: AssetType
  positions: PortfolioPositionRequest[]
  what_if?: {
    delta_sigma?: number
    date_of_calculation?: string
  }
}

export interface CalculatedPosition extends PortfolioPositionRequest {
  volatility?: number | null
  volatility_source?: string | null
  mark_price?: number | null
  valuation_source?: string | null
  delta?: number | null
  gamma?: number | null
  vega?: number | null
  theta?: number | null
  rho?: number | null
  profit_and_loss?: number | null
  profit_and_loss_rub?: number | null
  fee?: number | null
  strike?: number | null
  expiration_date?: string | null
  days_until_expiring?: number | null
  theorprice?: number | null
  expired?: boolean
}

export interface PortfolioTotals {
  delta?: number | null
  gamma?: number | null
  vega?: number | null
  theta?: number | null
  rho?: number | null
  profit_and_loss?: number | null
  profit_and_loss_rub?: number | null
  fee?: number | null
}

export interface CalculatedPortfolio {
  positions: CalculatedPosition[]
  total: PortfolioTotals
  initial_margin?: number | null
  valuation_context?: ValuationContext | null
}

export interface IndicatorPoint {
  underlying_price: number
  value: number
}

export interface IndicatorGraph {
  now: IndicatorPoint[]
  on_expiration: IndicatorPoint[]
  on_what_if?: IndicatorPoint[] | null
  valuation_context?: ValuationContext | null
}

export interface MarketPrice {
  secid: string
  price: number | null
  updatedAt?: string | null
  source: 'MIDPOINT' | 'LAST' | 'SETTLEMENT' | 'unavailable'
}

export interface InstrumentSpecification extends MarketPrice {
  price: number
  source: 'MIDPOINT' | 'LAST'
  minStep: number
  stepPrice: number
  lotSize: number
}
