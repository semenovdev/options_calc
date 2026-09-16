import type { PortfolioRequest } from '@/types/moex'
import type { Position, Strategy } from '@/types/portfolio'

export function toPortfolioRequest(
  strategy: Strategy,
  positions = strategy.positions,
): PortfolioRequest {
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
    what_if: {
      date_of_calculation: strategy.calculationDate || undefined,
      delta_sigma: strategy.volatilityShift || undefined,
    },
  }
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function clonePosition(position: Position): Position {
  return { ...position, id: createId('position') }
}
