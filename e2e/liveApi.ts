import type { APIRequestContext, Page } from '@playwright/test'

export const TARGET_API_PREFIX = '/moex-option-calc'

export interface Asset {
  asset_code: string
  title: string
  asset_type: string
}

export interface OptionSeries {
  optionseries_code: string
  asset_code: string
  asset_type: string
  futures_code?: string | null
  expiration_date: string
  central_strike?: number | null
}

export interface OptionRow {
  secid: string
  strike: number
  theorprice?: number | null
  volatility?: number | null
}

export interface OptionBoard {
  call: OptionRow[]
  put: OptionRow[]
}

export function optionBoard(
  request: APIRequestContext,
  prefix: string,
  entry: CatalogEntry,
  series: OptionSeries,
): Promise<OptionBoard> {
  return getJson<OptionBoard>(
    request,
    endpoint(
      prefix,
      `assets/${encodeURIComponent(entry.asset.asset_code)}/optionseries/${encodeURIComponent(series.optionseries_code)}/optionboard?asset_type=${encodeURIComponent(entry.asset.asset_type)}`,
    ),
  )
}

export interface LiveCase {
  asset: Asset
  series: OptionSeries
  call: OptionRow
  put: OptionRow
}

export interface CatalogEntry {
  asset: Asset
  series: OptionSeries[]
}

export async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let retry = true
    try {
      const response = await request.get(path, { timeout: 25_000 })
      if (response.ok()) return response.json() as Promise<T>
      const text = await response.text()
      let body: { code?: unknown; retryable?: unknown } | null = null
      try {
        body = JSON.parse(text)
      } catch {
        /* Legacy errors need not be JSON. */
      }
      lastError = new Error(`GET ${path} returned ${response.status()}: ${text.slice(0, 300)}`)
      retry =
        (response.status() === 408 || response.status() === 429 || response.status() >= 500) &&
        !(typeof body?.code === 'string' && typeof body.retryable === 'boolean')
    } catch (error) {
      lastError = error
    }
    if (!retry || attempt === 3) break
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
  }
  throw lastError
}

function endpoint(prefix: string, path: string): string {
  return `${prefix.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function theoretical(rows: OptionRow[]): OptionRow[] {
  return rows.filter(
    (row) =>
      Number.isFinite(row.strike) &&
      Number.isFinite(row.theorprice) &&
      Number.isFinite(row.volatility) &&
      row.strike > 0 &&
      row.theorprice! >= 0 &&
      row.volatility! > 0,
  )
}

function nearest(rows: OptionRow[], strike: number | null | undefined): OptionRow | undefined {
  if (!rows.length) return undefined
  if (!strike) return rows[0]
  return [...rows].sort(
    (left, right) => Math.abs(left.strike - strike) - Math.abs(right.strike - strike),
  )[0]
}

export async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        results[index] = await mapper(items[index]!)
      }
    }),
  )
  return results
}

export async function catalogFrom(
  request: APIRequestContext,
  prefix = '',
): Promise<CatalogEntry[]> {
  const assets = await assetsFrom(request, prefix)
  const uniqueAssets = Array.from(
    new Map(assets.map((asset) => [`${asset.asset_type}:${asset.asset_code}`, asset])).values(),
  )
  const today = new Date().toISOString().slice(0, 10)
  const entries = await mapLimit(uniqueAssets, 1, async (asset) => {
    const series = await getJson<OptionSeries[]>(
      request,
      endpoint(
        prefix,
        `assets/${encodeURIComponent(asset.asset_code)}/optionseries?asset_type=${encodeURIComponent(asset.asset_type)}`,
      ),
    )
    return { asset, series: series.filter((item) => item.expiration_date >= today) }
  })
  return entries.filter((entry) => entry.series.length)
}

export function assetsFrom(request: APIRequestContext, prefix = ''): Promise<Asset[]> {
  return getJson<Asset[]>(request, endpoint(prefix, 'assets'))
}

export async function targetCatalog(page: Page): Promise<CatalogEntry[]> {
  return catalogFrom(page.request, TARGET_API_PREFIX)
}

let liveCasePromise: Promise<LiveCase> | undefined

export function discoverLiveCase(page: Page): Promise<LiveCase> {
  liveCasePromise ??= (async () => {
    const preferred = ['SBRF', 'SI', 'RTS', 'GAZR']
    const assets = await getJson<Asset[]>(page.request, endpoint(TARGET_API_PREFIX, 'assets'))
    for (const code of preferred) {
      const asset = assets.find(
        (candidate) =>
          candidate.asset_type === 'futures' && candidate.asset_code.toUpperCase() === code,
      )
      if (!asset) continue
      const seriesList = await getJson<OptionSeries[]>(
        page.request,
        endpoint(
          TARGET_API_PREFIX,
          `assets/${encodeURIComponent(asset.asset_code)}/optionseries?asset_type=${encodeURIComponent(asset.asset_type)}`,
        ),
      )
      const entry = { asset, series: seriesList }
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(
        new Date(),
      )
      const activeSeries = entry.series
        .filter((series) => series.expiration_date >= today)
        .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date))
      for (const series of activeSeries.slice(0, 8)) {
        try {
          const board = await getJson<OptionBoard>(
            page.request,
            endpoint(
              TARGET_API_PREFIX,
              `assets/${encodeURIComponent(entry.asset.asset_code)}/optionseries/${encodeURIComponent(series.optionseries_code)}/optionboard?asset_type=${encodeURIComponent(entry.asset.asset_type)}`,
            ),
          )
          const call = nearest(theoretical(board.call), series.central_strike)
          const put = nearest(theoretical(board.put), series.central_strike)
          if (call && put) return { asset: entry.asset, series, call, put }
        } catch {
          // Vendor catalogs can contain temporarily incomplete boards.
        }
      }
    }
    throw new Error('No active option series with theoretical Call and Put prices was found')
  })().catch((error: unknown) => {
    liveCasePromise = undefined
    throw error
  })
  return liveCasePromise
}
