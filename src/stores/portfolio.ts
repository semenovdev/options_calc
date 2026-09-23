import { computed, onScopeDispose, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import {
  resolveLinearSpecification,
  resolveUnderlyingMarketPrice,
  valuationMarketPrice,
} from '@/api/backendMarketData'
import { isAbortError } from '@/api/http'
import { optionCalcApi } from '@/api/optionCalc'
import type {
  CalculatedPortfolio,
  IndicatorGraph,
  IndicatorType,
  PortfolioRequest,
  PortfolioTotals,
} from '@/types/moex'
import type { CalculationState, Position, Strategy } from '@/types/portfolio'
import { todayMoscow } from '@/utils/format'
import {
  addLinearPositionsToGraph,
  linearMultiplier,
  linearPnl,
  type LinearPosition,
} from '@/utils/linearPnl'
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

function graphValidationError(graph: IndicatorGraph | null | undefined): string | null {
  if (!graph) return 'backend returned no graph'
  for (const series of ['now', 'on_expiration'] as const) {
    const points = graph[series]
    if (!Array.isArray(points)) return `backend returned an invalid ${series} series`
    if (!points.length) return `backend returned an empty ${series} series`
    const invalidIndex = points.findIndex(
      (point) =>
        !point || !Number.isFinite(point.underlying_price) || !Number.isFinite(point.value),
    )
    if (invalidIndex >= 0) {
      return `backend returned an invalid point in ${series} at index ${invalidIndex}`
    }
  }

  if (graph.on_what_if != null && !Array.isArray(graph.on_what_if)) {
    return 'backend returned an invalid on_what_if series'
  }
  const invalidScenarioIndex = graph.on_what_if?.findIndex(
    (point) => !point || !Number.isFinite(point.underlying_price) || !Number.isFinite(point.value),
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

interface PreparedCalculation {
  portfolio: CalculatedPortfolio
  linear: LinearPosition[]
  spot: number
}

interface CalculationRun {
  controller: AbortController
  payload: PortfolioRequest
  hasScenario: boolean
  scenarioTotals: PortfolioTotals
  ready: Promise<PreparedCalculation>
  graphs: Map<IndicatorType, Promise<void>>
}

export const usePortfolioStore = defineStore('portfolio', () => {
  const restored = restore()
  const strategies = ref<Strategy[]>(restored.strategies)
  const activeId = ref(restored.activeId)
  const focusedPositionId = ref<string | null>(null)
  const selectedIndicator = ref<IndicatorType>('profit_and_loss')
  const profileVisible = ref(true)
  const calculation = reactive<CalculationState>({
    portfolio: null,
    graphs: {},
    graphLoading: {},
    loading: false,
    error: null,
    calculatedAt: null,
  })
  let currentRun: CalculationRun | undefined

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
    currentRun?.controller.abort()
    currentRun = undefined
    calculation.portfolio = null
    calculation.graphs = {}
    calculation.graphLoading = {}
    calculation.loading = false
    calculation.error = null
    calculation.calculatedAt = null
  }

  onScopeDispose(() => currentRun?.controller.abort())

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

  async function prepareCalculation(
    strategy: Strategy,
    selectedPositions: Position[],
    signal: AbortSignal,
  ): Promise<PreparedCalculation> {
    const optionPositions = selectedPositions.filter((position) => position.type === 'option')
    const linearPositions = selectedPositions.filter(
      (position): position is Position & { type: 'futures' | 'share' } =>
        position.type === 'futures' || position.type === 'share',
    )
    const options = { signal }
    const optionPayload = toPortfolioRequest(strategy, optionPositions)
    const [fullPortfolio, optionPortfolio, linear] = await Promise.all([
      linearPositions.length
        ? optionCalcApi.calculatePortfolio(
            { ...toPortfolioRequest(strategy, selectedPositions), what_if: undefined },
            options,
          )
        : Promise.resolve(undefined),
      optionPositions.length
        ? optionCalcApi.calculatePortfolio({ ...optionPayload, what_if: undefined }, options)
        : Promise.resolve(undefined),
      Promise.all(
        linearPositions.map(async (position) => ({
          position,
          specification: await resolveLinearSpecification(
            strategy.assetCode,
            position.secid,
            position.type,
            options,
          ),
        })),
      ),
    ])
    signal.throwIfAborted()
    const quoteSecid =
      selectedPositions.find((position) => position.underlyingFutureCode)?.underlyingFutureCode ??
      selectedPositions.find((position) => position.type === 'futures')?.secid ??
      strategy.assetCode
    const optionSeriesCode = optionPositions.find(
      (position) => position.optionSeriesCode,
    )?.optionSeriesCode
    const valuationContext = (fullPortfolio ?? optionPortfolio)?.valuation_context
    const market =
      valuationMarketPrice(valuationContext) ??
      (await resolveUnderlyingMarketPrice(
        strategy.assetCode,
        strategy.assetType,
        quoteSecid,
        optionSeriesCode,
        options,
      ))
    signal.throwIfAborted()
    if (market.price === null) throw new Error(`Нет текущей цены базового актива ${quoteSecid}`)
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
    return {
      spot: market.price,
      linear,
      portfolio: {
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
        ...(valuationContext !== undefined ? { valuation_context: valuationContext } : {}),
      },
    }
  }

  function loadGraph(indicator: IndicatorType, run = currentRun): Promise<void> {
    if (
      !run ||
      run !== currentRun ||
      run.controller.signal.aborted ||
      calculation.graphs[indicator]
    ) {
      return Promise.resolve()
    }
    const pending = run.graphs.get(indicator)
    if (pending) return pending
    calculation.graphLoading[indicator] = true
    const request = (async () => {
      const [graphResult, contextResult] = await Promise.allSettled([
        run.payload.positions.length
          ? optionCalcApi.getPortfolioGraph(indicator, run.payload, {
              signal: run.controller.signal,
            })
          : Promise.resolve(undefined),
        run.ready,
      ])
      if (
        currentRun !== run ||
        run.controller.signal.aborted ||
        contextResult.status === 'rejected'
      )
        return
      if (graphResult.status === 'rejected') {
        if (!isAbortError(graphResult.reason)) {
          globalThis.console.error(
            `[MOEX Options] ${indicatorLabels[indicator]} chart error:`,
            graphResult.reason,
          )
        }
        return
      }
      const validationError =
        run.payload.positions.length && graphValidationError(graphResult.value)
      if (validationError) {
        globalThis.console.error(
          `[MOEX Options] ${indicatorLabels[indicator]} chart error: ${validationError}`,
        )
        return
      }
      const { linear, spot } = contextResult.value
      const graph = addLinearPositionsToGraph(graphResult.value, linear, indicator, spot)
      calculation.graphs[indicator] = graph
      if (run.hasScenario && graph.on_what_if) {
        const value = indicatorValueAt(graph.on_what_if, spot)
        if (value !== null) {
          run.scenarioTotals[indicator] = value
          if (indicator === 'profit_and_loss') run.scenarioTotals.profit_and_loss_rub = value
        }
      }
    })().finally(() => {
      run.graphs.delete(indicator)
      if (currentRun === run) calculation.graphLoading[indicator] = false
    })
    run.graphs.set(indicator, request)
    return request
  }

  async function calculate(): Promise<void> {
    const active = activeStrategy.value
    if (!active?.positions.length) return
    const selectedPositions = (
      focusedPosition.value ? [focusedPosition.value] : active.positions
    ).map((position) => ({ ...position }))
    const strategy = { ...active, positions: selectedPositions }
    resetCalculation()
    active.marketPrice = null
    calculation.loading = true
    const controller = new AbortController()
    const run: CalculationRun = {
      controller,
      payload: toPortfolioRequest(
        strategy,
        selectedPositions.filter((position) => position.type === 'option'),
      ),
      hasScenario: Boolean(strategy.volatilityShift) || strategy.calculationDate !== todayMoscow(),
      scenarioTotals: {},
      ready: prepareCalculation(strategy, selectedPositions, controller.signal),
      graphs: new Map(),
    }
    currentRun = run
    // The visible graph starts alongside portfolio valuation and is published independently.
    const visibleGraph = profileVisible.value
      ? loadGraph(selectedIndicator.value, run)
      : Promise.resolve()
    try {
      const prepared = await run.ready
      if (currentRun !== run) return
      active.marketPrice = prepared.spot
      calculation.portfolio = prepared.portfolio
      calculation.calculatedAt = new Date().toISOString()
    } catch (error) {
      if (currentRun !== run || isAbortError(error)) return
      calculation.error = error instanceof Error ? error.message : 'Не удалось рассчитать портфель'
      controller.abort()
    } finally {
      if (currentRun === run) calculation.loading = false
    }
    await visibleGraph
    // Scenario totals need every Greek; ordinary profile browsing only loads the selected graph.
    if (run.hasScenario) {
      const remaining = indicators.filter((indicator) => !calculation.graphs[indicator])
      for (let index = 0; index < remaining.length; index += 2) {
        if (currentRun !== run || controller.signal.aborted) break
        await Promise.all(
          remaining.slice(index, index + 2).map((indicator) => loadGraph(indicator, run)),
        )
      }
      if (currentRun === run && calculation.portfolio) {
        calculation.portfolio.total = { ...calculation.portfolio.total, ...run.scenarioTotals }
      }
    }
  }

  watch([selectedIndicator, profileVisible], ([indicator, visible]) => {
    if (visible) void loadGraph(indicator)
  })

  return {
    strategies,
    activeId,
    activeStrategy,
    focusedPositionId,
    focusedPosition,
    selectedIndicator,
    profileVisible,
    calculation,
    selectStrategy,
    addStrategy,
    removeStrategy,
    addPosition,
    updatePosition,
    removePosition,
    calculate,
    loadGraph,
    resetCalculation,
  }
})
