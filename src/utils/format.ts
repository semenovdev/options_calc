const numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const fixedMoneyFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
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

export function formatMoneyFixed(value?: number | null): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${fixedMoneyFormatter.format(value)} ₽`
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
  const formatted = numberFormatter.format(value)
  return value > 0 && formatted === '0' ? '+0' : formatted
}

export function todayMoscow(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date())
}
