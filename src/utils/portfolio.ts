import type { PortfolioRequest } from '@/types/moex'
import type { Position, Strategy } from '@/types/portfolio'
import { todayMoscow } from './format'

export function toPortfolioRequest(
  strategy: Strategy,
  positions = strategy.positions,
): PortfolioRequest {
  const deltaSigma = strategy.volatilityShift || undefined
  const calculationDate = strategy.calculationDate || (deltaSigma ? todayMoscow() : undefined)

  return {
    asset_code: strategy.assetCode,
    asset_type: strategy.assetType,
    positions: positions.map((position) => ({
      secid: position.secid,
      type: position.type,
      quantity: position.quantity,
      price: position.price,
      volatility: position.volatility,
      netted_im: position.nettedIm,
    })),
    ...(calculationDate
      ? {
          what_if: {
            date_of_calculation: calculationDate,
            delta_sigma: deltaSigma,
          },
        }
      : {}),
  }
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function clonePosition(position: Position): Position {
  return { ...position, id: createId('position') }
}

function weightedValue(
  current: number | undefined,
  currentQuantity: number,
  incoming: number | undefined,
  incomingQuantity: number,
): number | undefined {
  if (current === undefined) return incoming
  if (incoming === undefined) return current
  return (
    (current * Math.abs(currentQuantity) + incoming * Math.abs(incomingQuantity)) /
    (Math.abs(currentQuantity) + Math.abs(incomingQuantity))
  )
}

export function mergePosition(current: Position, incoming: Omit<Position, 'id'>): Position | null {
  const quantity = current.quantity + incoming.quantity
  if (quantity === 0) return null

  const sameDirection = Math.sign(current.quantity) === Math.sign(incoming.quantity)
  const keepsCurrentDirection = Math.sign(quantity) === Math.sign(current.quantity)
  return {
    ...current,
    ...incoming,
    id: current.id,
    quantity,
    price: sameDirection
      ? weightedValue(current.price, current.quantity, incoming.price, incoming.quantity)
      : keepsCurrentDirection
        ? current.price
        : incoming.price,
    volatility: sameDirection
      ? weightedValue(current.volatility, current.quantity, incoming.volatility, incoming.quantity)
      : keepsCurrentDirection
        ? current.volatility
        : incoming.volatility,
  }
}
