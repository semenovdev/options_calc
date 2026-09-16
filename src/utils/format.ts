const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const compactFormatter = new Intl.NumberFormat('ru-RU', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatNumber(value?: number | null, fallback = '—'): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? fallback
    : numberFormatter.format(value)
}

export function formatMoney(value?: number | null): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${numberFormatter.format(value)} ₽`
}

export function formatCompact(value?: number | null): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : compactFormatter.format(value)
}

export function formatPercent(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${numberFormatter.format(value > 1 ? value : value * 100)}%`
}

export function signed(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${numberFormatter.format(value)}`
}

export function todayMoscow(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date())
}
