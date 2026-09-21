import type { Strategy } from '@/types/portfolio'

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

export function exportStrategyJson(strategy: Strategy): void {
  download(
    `${strategy.assetCode}-${strategy.name}.json`,
    JSON.stringify({ exportedAt: new Date().toISOString(), strategy }, null, 2),
    'application/json;charset=utf-8',
  )
}

export function exportStrategyCsv(strategy: Strategy): void {
  const headers = [
    'strategy',
    'asset_code',
    'secid',
    'type',
    'quantity',
    'price',
    'expiration_date',
    'strike',
    'option_type',
  ]
  const lines = [headers.map(csvCell).join(',')]
  strategy.positions.forEach((position) => {
    lines.push(
      [
        strategy.name,
        strategy.assetCode,
        position.secid,
        position.type,
        position.quantity,
        position.price,
        position.expirationDate,
        position.strike,
        position.optionType,
      ]
        .map(csvCell)
        .join(','),
    )
  })
  download(
    `${strategy.assetCode}-${strategy.name}.csv`,
    `\uFEFF${lines.join('\n')}`,
    'text/csv;charset=utf-8',
  )
}
