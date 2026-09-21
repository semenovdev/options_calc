import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { resolveLinearSpecification, resolveUnderlyingMarketPrice } from '@/api/backendMarketData'
import { optionCalcApi } from '@/api/optionCalc'
import type { IndicatorGraph, IndicatorType } from '@/types/moex'
import type { CalculationState, Position, Strategy } from '@/types/portfolio'
import { todayMoscow } from '@/utils/format'
import { addLinearPositionsToGraph, linearMultiplier, linearPnl } from '@/utils/linearPnl'
import { indicatorValueAt } from '@/utils/options'
import { createId, mergePosition, toPortfolioRequest } from '@/utils/portfolio'

const STORAGE_KEY = 'moex-options-workbench:v1'
const indicators: IndicatorType[] = ['profit_and_loss', 'delta', 'gamma', 'vega', 'theta', 'rho']
const indicatorLabels: Record<IndicatorType, string> = {
  profit_and_loss: 'PnL',
  delta: 'Delta',
  gamma: 'Gamma',
  vega: 'Vega',
  theta: 'Theta',
  rho: 'Rho',
}

function graphValidationError(graph: IndicatorGraph): string | null {
  for (const series of ['now', 'on_expiration'] as const) {
    const points = graph[series]
    if (!points.length) return `backend returned an empty ${series} series`
    const invalidIndex = points.findIndex(
      (point) => !Number.isFinite(point.underlying_price) || !Number.isFinite(point.value),
    )
    if (invalidIndex >= 0) {
      return `backend returned an invalid point in ${series} at index ${invalidIndex}`
    }
  }

  const invalidScenarioIndex = graph.on_what_if?.findIndex(
    (point) => !Number.isFinite(point.underlying_price) || !Number.isFinite(point.value),
  )
  return invalidScenarioIndex !== undefined && invalidScenarioIndex >= 0
    ? `backend returned an invalid point in on_what_if at index ${invalidScenarioIndex}`
    : null
}

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

async function loadOptionGraphs(
  payload: ReturnType<typeof toPortfolioRequest>,
): Promise<Partial<Record<IndicatorType, IndicatorGraph>>> {
  const graphs: Partial<Record<IndicatorType, IndicatorGraph>> = {}
  const concurrency = 2
  for (let index = 0; index < indicators.length; index += concurrency) {
    const batch = indicators.slice(index, index + concurrency)
    const results = await Promise.allSettled(
      batch.map((indicator) => optionCalcApi.getPortfolioGraph(indicator, payload)),
    )
    results.forEach((result, resultIndex) => {
      const indicator = batch[resultIndex]!
      if (result.status === 'rejected') {
        globalThis.console.error(
          `[MOEX Options] ${indicatorLabels[indicator]} chart error:`,
          result.reason,
        )
        return
      }
      const validationError = graphValidationError(result.value)
      if (validationError) {
        globalThis.console.error(
          `[MOEX Options] ${indicatorLabels[indicator]} chart error: ${validationError}`,
        )
        return
      }
      graphs[indicator] = result.value
    })
  }
  return graphs
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
    calculation.portfolio = null
    calculation.graphs = {}
    calculation.calculatedAt = null
    const selectedPositions = focusedPosition.value ? [focusedPosition.value] : strategy.positions
    const optionPositions = selectedPositions.filter((position) => position.type === 'option')
    const linearPositions = selectedPositions.filter(
      (position): position is Position & { type: 'futures' | 'share' } =>
        position.type === 'futures' || position.type === 'share',
    )
    try {
      const quoteSecid =
        selectedPositions.find((position) => position.underlyingFutureCode)?.underlyingFutureCode ??
        selectedPositions.find((position) => position.type === 'futures')?.secid ??
        strategy.assetCode
      const optionSeriesCode = selectedPositions.find(
        (position) => position.type === 'option' && position.optionSeriesCode,
      )?.optionSeriesCode
      const marketPromise = resolveUnderlyingMarketPrice(
        strategy.assetCode,
        strategy.assetType,
        quoteSecid,
        optionSeriesCode,
      )
      const linearPromise = Promise.all(
        linearPositions.map(async (position) => ({
          position,
          specification: await resolveLinearSpecification(
            strategy.assetCode,
            position.secid,
            position.type,
          ),
        })),
      )
      const optionPayload = toPortfolioRequest(strategy, optionPositions)
      const currentPortfolioPayload = {
        ...toPortfolioRequest(strategy, selectedPositions),
        what_if: undefined,
      }
      const currentOptionPayload = { ...optionPayload, what_if: undefined }
      const optionGraphsPromise = optionPositions.length
        ? loadOptionGraphs(optionPayload)
        : Promise.resolve({} as Partial<Record<IndicatorType, IndicatorGraph>>)
      const [fullPortfolio, optionPortfolio, market, linear] = await Promise.all([
        linearPositions.length
          ? optionCalcApi.calculatePortfolio(currentPortfolioPayload)
          : Promise.resolve(undefined),
        optionPositions.length
          ? optionCalcApi.calculatePortfolio(currentOptionPayload)
          : Promise.resolve(undefined),
        marketPromise,
        linearPromise,
      ])
      if (market.price === null) throw new Error(`Нет текущей цены базового актива ${quoteSecid}`)
      const spot = market.price
      strategy.marketPrice = market.price
      const linearPnlNow = linear.reduce(
        (total, item) => total + linearPnl(item, item.specification.price),
        0,
      )
      const linearDelta = linear.reduce(
        (total, item) => total + item.position.quantity * linearMultiplier(item),
        0,
      )
      const totals = { ...(optionPortfolio?.total ?? {}) }
      const addLinearValue = (value: number | null | undefined, linearValue: number) =>
        value == null ? (optionPositions.length ? value : linearValue) : value + linearValue
      totals.profit_and_loss = addLinearValue(totals.profit_and_loss, linearPnlNow)
      totals.profit_and_loss_rub = addLinearValue(totals.profit_and_loss_rub, linearPnlNow)
      totals.delta = addLinearValue(totals.delta, linearDelta)
      if (requestId !== calculationRequestId) return
      calculation.portfolio = {
        positions: [
          ...(optionPortfolio?.positions ?? []),
          ...linear.map(({ position, specification }) => ({
            secid: position.secid,
            type: position.type,
            quantity: position.quantity,
            price: position.price,
            profit_and_loss: linearPnl({ position, specification }, specification.price),
            profit_and_loss_rub: linearPnl({ position, specification }, specification.price),
            delta: position.quantity * linearMultiplier({ position, specification }),
          })),
        ],
        total: totals,
        initial_margin: linearPositions.length
          ? fullPortfolio?.initial_margin
          : optionPortfolio?.initial_margin,
      }
      calculation.calculatedAt = new Date().toISOString()

      const optionGraphs = await optionGraphsPromise
      const graphs = Object.fromEntries(
        indicators.flatMap((indicator) => {
          const optionGraph = optionGraphs[indicator]
          if (!optionGraph && optionPositions.length) return []
          return [[indicator, addLinearPositionsToGraph(optionGraph, linear, indicator, spot)]]
        }),
      ) as Partial<Record<IndicatorType, IndicatorGraph>>
      const hasScenario =
        Boolean(strategy.volatilityShift) || strategy.calculationDate !== todayMoscow()
      if (hasScenario) {
        indicators.forEach((indicator) => {
          const points = graphs[indicator]?.on_what_if
          const value = points ? indicatorValueAt(points, spot) : null
          if (value === null) return
          totals[indicator] = value
          if (indicator === 'profit_and_loss') totals.profit_and_loss_rub = value
        })
      }
      if (requestId !== calculationRequestId) return
      if (calculation.portfolio) calculation.portfolio.total = totals
      calculation.graphs = graphs
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
