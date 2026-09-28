import { MoexApiError } from './http'
import type { CalculationWarning } from '@/types/moex'

export function hasModelWarning(warnings?: CalculationWarning[]): boolean {
  return warnings?.some((warning) => warning.code === 'MODEL_DATA_UNAVAILABLE') ?? false
}

export const partialPortfolioWarning =
  'P&L рассчитан по доступным ценам. Для части позиций недоступны IV и модельная аналитика.'
export const partialGraphWarning =
  'Недостаточно данных для модельных линий. Показан доступный расчёт на экспирацию.'

const unavailableQuotes =
  'Сейчас недостаточно котировок для расчёта. Это возможно вне торговой сессии или при отсутствии заявок.'

function missingInput(reason: string): boolean {
  return (
    /^missing (?:market|settlement) price for \S+$/.test(reason) ||
    /^missing quote for \S+$/.test(reason) ||
    /^volatility unavailable for (?:series|strike)(?: for \S+)?$/.test(reason)
  )
}

export function marketDataWarning(error: unknown): string | null {
  if (!(error instanceof MoexApiError) || error.status !== 503) return null
  const body = error.details
  if (
    !body ||
    typeof body !== 'object' ||
    !('code' in body) ||
    body.code !== 'LIVE_DATA_UNAVAILABLE'
  )
    return null

  // The legacy error envelope has no typed availability reason. Only recognize
  // explicit missing inputs; unknown failures and model validation remain errors.
  const contexts =
    /^Neither market nor settlement valuation context is complete: market: (.+); settlement: (.+)$/.exec(
      error.message,
    )
  const reasons = contexts ? contexts.slice(1) : [error.message]
  return reasons.every(missingInput) ? unavailableQuotes : null
}
