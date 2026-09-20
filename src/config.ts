function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function baseUrl(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().replace(/\/+$/, '')
  return normalized || fallback
}

export const appConfig = {
  optionCalcBaseUrl: baseUrl(import.meta.env.VITE_OPTION_CALC_BASE_URL, '/moex-option-calc'),
  autoRefreshIntervalMs: positiveNumber(import.meta.env.VITE_AUTO_REFRESH_INTERVAL_MS, 60_000),
} as const
