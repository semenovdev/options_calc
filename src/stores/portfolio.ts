import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { getInstrumentSpecification } from '@/api/iss'
import { optionCalcApi } from '@/api/optionCalc'
import type { CalculatedPortfolio, IndicatorGraph, IndicatorType } from '@/types/moex'
import type { CalculationState, Position, Strategy } from '@/types/portfolio'
import { todayMoscow } from '@/utils/format'
import { addLinearPositionsToGraph, linearMultiplier, linearPnl } from '@/utils/linearPnl'
import { indicatorValueAt } from '@/utils/options'
import { createId, mergePosition, toPortfolioRequest } from '@/utils/portfolio'

const STORAGE_KEY = 'moex-options-workbench:v1'
const indicators: IndicatorType[] = ['profit_and_loss', 'delta', 'gamma', 'vega', 'theta', 'rho']

function initialStrategy(): Strategy {
  return {
    id: createId('strategy'),
    name: 'Новая стратегия',
    assetCode: 'SBER',
    assetType: 'share',
    positions: [],
    calculationDate: todayMoscow(),
    volatilityShift: 0,
    marketPrice: null,
  }
}

function restore(): { strategies: Strategy[]; activeId: string } {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as {
      strategies: Strategy[]
      activeId: string
    }
    if (stored.strategies?.length) return stored
  } catch {
    // Invalid local data is ignored; the next write replaces it.
  }
  const strategy = initialStrategy()
  return { strategies: [strategy], activeId: strategy.id }
}

export const usePortfolioStore = defineStore('portfolio', () => {
  const restored = restore()
  const strategies = ref<Strategy[]>(restored.strategies)
  const activeId = ref(restored.activeId)
  const focusedPositionId = ref<string | null>(null)
  const calculation = reactive<CalculationState>({
    portfolio: null,
    graphs: {},
    loading: false,
    error: null,
    calculatedAt: null,
  })
  let calculationRequestId = 0

  const activeStrategy = computed(() =>
    strategies.value.find((strategy) => strategy.id === activeId.value),
  )
  const focusedPosition = computed(() =>
    activeStrategy.value?.positions.find((position) => position.id === focusedPositionId.value),
  )

  watch(
    [strategies, activeId],
    () =>
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ strategies: strategies.value, activeId: activeId.value }),
      ),
    { deep: true },
  )

  function resetCalculation(): void {
    calculationRequestId += 1
    calculation.portfolio = null
    calculation.graphs = {}
    calculation.error = null
    calculation.calculatedAt = null
  }

  function selectStrategy(id: string): void {
    activeId.value = id
    focusedPositionId.value = null
    resetCalculation()
  }

  function addStrategy(): void {
    const strategy = initialStrategy()
    strategy.name = `Стратегия ${strategies.value.length + 1}`
    strategies.value.push(strategy)
    selectStrategy(strategy.id)
  }

  function removeStrategy(id: string): void {
    if (strategies.value.length === 1) return
    strategies.value = strategies.value.filter((strategy) => strategy.id !== id)
    if (activeId.value === id) selectStrategy(strategies.value[0]!.id)
  }

  function addPosition(position: Omit<Position, 'id'>): void {
    const strategy = activeStrategy.value
    if (!strategy) return
    focusedPositionId.value = null
    const existingIndex = strategy.positions.findIndex(
      (item) => item.secid === position.secid && item.type === position.type,
    )
    if (existingIndex === -1) {
      strategy.positions.push({ ...position, id: createId('position') })
    } else {
      const merged = mergePosition(strategy.positions[existingIndex]!, position)
      if (merged) strategy.positions[existingIndex] = merged
      else strategy.positions.splice(existingIndex, 1)
    }
    resetCalculation()
  }

  function updatePosition(id: string, patch: Partial<Position>): void {
    const position = activeStrategy.value?.positions.find((item) => item.id === id)
    if (position) Object.assign(position, patch)
    resetCalculation()
  }

  function removePosition(id: string): void {
    const strategy = activeStrategy.value
    if (!strategy) return
    strategy.positions = strategy.positions.filter((position) => position.id !== id)
    if (focusedPositionId.value === id) focusedPositionId.value = null
    resetCalculation()
  }

  async function calculate(): Promise<void> {
    const strategy = activeStrategy.value
    if (!strategy?.positions.length) return
    const requestId = ++calculationRequestId
    calculation.loading = true
    calculation.error = null
    const selectedPositions = focusedPosition.value ? [focusedPosition.value] : strategy.positions
    const optionPositions = selectedPositions.filter((position) => position.type === 'option')
    const linearPositions = selectedPositions.filter(
      (position): position is Position & { type: 'futures' | 'share' } =>
        position.type === 'futures' || position.type === 'share',
    )
    try {
      const linear = await Promise.all(
        linearPositions.map(async (position) => ({
          position,
          specification: await getInstrumentSpecification(position.secid, position.type),
        })),
      )
      const optionPayload = toPortfolioRequest(strategy, optionPositions)
      const currentPortfolioPayload = {
        ...toPortfolioRequest(strategy, selectedPositions),
        what_if: undefined,
      }
      const currentOptionPayload = { ...optionPayload, what_if: undefined }
      const [fullPortfolioResult, optionResults] = await Promise.all([
        linearPositions.length
          ? optionCalcApi
              .calculatePortfolio(currentPortfolioPayload)
              .then((value) => ({ value }))
              .catch(() => ({ value: null }))
          : Promise.resolve({ value: null }),
        optionPositions.length
          ? Promise.all([
              optionCalcApi.calculatePortfolio(currentOptionPayload),
              ...indicators.map((indicator) =>
                optionCalcApi.getPortfolioGraph(indicator, optionPayload),
              ),
            ])
          : Promise.resolve([]),
      ])
      const fullPortfolio = fullPortfolioResult.value
      const optionPortfolio = optionResults[0] as CalculatedPortfolio | undefined
      const optionGraphs = optionResults.slice(1) as IndicatorGraph[]
      const linearPnlNow = linear.reduce(
        (total, item) =>
          total + linearPnl(item, item.specification.price ?? item.position.price ?? 0),
        0,
      )
      const linearDelta = linear.reduce(
        (total, item) => total + item.position.quantity * linearMultiplier(item),
        0,
      )
      const totals = { ...(optionPortfolio?.total ?? {}) }
      totals.profit_and_loss = (totals.profit_and_loss ?? 0) + linearPnlNow
      totals.profit_and_loss_rub = (totals.profit_and_loss_rub ?? 0) + linearPnlNow
      totals.delta = (totals.delta ?? 0) + linearDelta
      const spot =
        strategy.marketPrice ??
        linear.find((item) => item.specification.price !== null)?.specification.price ??
        selectedPositions.find((position) => position.price !== undefined)?.price ??
        100
      const graphs = Object.fromEntries(
        indicators.map((indicator, index) => [
          indicator,
          addLinearPositionsToGraph(optionGraphs[index], linear, indicator, spot),
        ]),
      ) as Record<IndicatorType, IndicatorGraph>
      const hasScenario =
        Boolean(strategy.volatilityShift) || strategy.calculationDate !== todayMoscow()
      if (hasScenario) {
        indicators.forEach((indicator) => {
          const points = graphs[indicator].on_what_if
          const value = points ? indicatorValueAt(points, spot) : null
          if (value === null) return
          totals[indicator] = value
          if (indicator === 'profit_and_loss') totals.profit_and_loss_rub = value
        })
      }
      if (requestId !== calculationRequestId) return
      calculation.portfolio = {
        positions: [
          ...(optionPortfolio?.positions ?? []),
          ...linear.map(({ position, specification }) => ({
            secid: position.secid,
            type: position.type,
            quantity: position.quantity,
            price: position.price,
            profit_and_loss: linearPnl(
              { position, specification },
              specification.price ?? position.price ?? 0,
            ),
            profit_and_loss_rub: linearPnl(
              { position, specification },
              specification.price ?? position.price ?? 0,
            ),
            delta: position.quantity * linearMultiplier({ position, specification }),
          })),
        ],
        total: totals,
        initial_margin: fullPortfolio?.initial_margin ?? optionPortfolio?.initial_margin,
      }
      calculation.graphs = graphs
      calculation.calculatedAt = new Date().toISOString()
    } catch (error) {
      if (requestId !== calculationRequestId) return
      calculation.error = error instanceof Error ? error.message : 'Не удалось рассчитать портфель'
    } finally {
      if (requestId === calculationRequestId) calculation.loading = false
    }
  }

  return {
    strategies,
    activeId,
    activeStrategy,
    focusedPositionId,
    focusedPosition,
    calculation,
    selectStrategy,
    addStrategy,
    removeStrategy,
    addPosition,
    updatePosition,
    removePosition,
    calculate,
    resetCalculation,
  }
})
