import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import { optionCalcApi } from '@/api/optionCalc'
import type { IndicatorType } from '@/types/moex'
import type { CalculationState, Position, Strategy } from '@/types/portfolio'
import { todayMoscow } from '@/utils/format'
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
    calculation.loading = true
    calculation.error = null
    const selectedPositions = focusedPosition.value ? [focusedPosition.value] : strategy.positions
    const payload = toPortfolioRequest(strategy, selectedPositions)
    try {
      const [portfolio, ...graphs] = await Promise.all([
        optionCalcApi.calculatePortfolio(payload),
        ...indicators.map((indicator) => optionCalcApi.getPortfolioGraph(indicator, payload)),
      ])
      calculation.portfolio = portfolio
      calculation.graphs = Object.fromEntries(
        indicators.map((indicator, index) => [indicator, graphs[index]]),
      )
      calculation.calculatedAt = new Date().toISOString()
    } catch (error) {
      calculation.error = error instanceof Error ? error.message : 'Не удалось рассчитать портфель'
    } finally {
      calculation.loading = false
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
