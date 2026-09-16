function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const appConfig = {
  autoRefreshIntervalMs: positiveNumber(import.meta.env.VITE_AUTO_REFRESH_INTERVAL_MS, 60_000),
} as const
