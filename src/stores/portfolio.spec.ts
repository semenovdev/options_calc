import { flushPromises } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { getInstrumentSpecification, getMarketPrice } from '@/api/iss'
import { optionCalcApi } from '@/api/optionCalc'
import type {
  CalculatedPortfolio,
  IndicatorGraph,
  IndicatorType,
  ValuationContext,
} from '@/types/moex'

import { usePortfolioStore } from './portfolio'

vi.mock('@/api/optionCalc', () => ({
  optionCalcApi: {
    calculatePortfolio: vi.fn(),
    getPortfolioGraph: vi.fn(),
    getOptionBoard: vi.fn(),
    getFutures: vi.fn(),
  },
}))
vi.mock('@/api/iss', () => ({ getMarketPrice: vi.fn(), getInstrumentSpecification: vi.fn() }))
vi.mock('@/config', () => ({ appConfig: { backend: 'moex' } }))

const calculate = vi.mocked(optionCalcApi.calculatePortfolio)
const getGraph = vi.mocked(optionCalcApi.getPortfolioGraph)
const getBoard = vi.mocked(optionCalcApi.getOptionBoard)
const getPrice = vi.mocked(getMarketPrice)
const context: ValuationContext = {
  mode: 'market',
  underlying_secid: 'SiZ6',
  underlying_price: 86_000,
  as_of: '2026-09-23T10:00:00Z',
}

function portfolio(): CalculatedPortfolio {
  return {
    positions: [{ secid: 'Si86000CALL', type: 'option', quantity: 1, price: 300, theorprice: 310 }],
    total: { profit_and_loss: 10, profit_and_loss_rub: 10, delta: 0.5 },
    valuation_context: context,
  }
}

function graph(value = 10): IndicatorGraph {
  const points = [
    { underlying_price: 85_000, value: value - 1 },
    { underlying_price: 86_000, value },
    { underlying_price: 87_000, value: value + 1 },
  ]
  return { now: points, on_expiration: points, valuation_context: context }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function populatedStore() {
  const store = usePortfolioStore()
  store.activeStrategy!.assetCode = 'SI'
  store.activeStrategy!.assetType = 'futures'
  store.addPosition({
    secid: 'Si86000CALL',
    type: 'option',
    quantity: 1,
    price: 300,
    nettedIm: true,
    optionSeriesCode: 'SI-SERIES',
    underlyingFutureCode: 'SiZ6',
    strike: 86_000,
  })
  return store
}

let pinia: Pinia
beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  pinia = createPinia()
  setActivePinia(pinia)
  calculate.mockImplementation(async () => portfolio())
  getGraph.mockImplementation(async () => graph())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  disposePinia(pinia)
  vi.restoreAllMocks()
})

describe('lazy portfolio calculations', () => {
  it('prepends new strategies, selects them and persists their order', async () => {
    const store = usePortfolioStore()
    const firstId = store.activeId
    store.addStrategy()
    const secondId = store.activeId
    store.addStrategy()
    const thirdId = store.activeId
    expect(store.strategies.map((strategy) => strategy.id)).toEqual([thirdId, secondId, firstId])
    expect(store.activeStrategy?.id).toBe(store.strategies[0]?.id)
    await nextTick()
    const saved = JSON.parse(localStorage.getItem('moex-options-workbench:v1')!)
    expect(saved.strategies.map((strategy: { id: string }) => strategy.id)).toEqual([
      thirdId,
      secondId,
      firstId,
    ])
    expect(saved.activeId).toBe(thirdId)
  })

  it.each([
    ['GLDRUB_TOM', 'commodity', 1],
    ['SLVRUB_TOM', 'commodity', 100],
    ['CNYRUB_TOM', 'currency', 1000],
  ] as const)(
    'includes the %s underlying in portfolio and graph calculations',
    async (secid, type, lotSize) => {
      const store = populatedStore()
      store.activeStrategy!.assetCode = secid
      store.activeStrategy!.assetType = 'share'
      store.activeStrategy!.positions[0]!.underlyingFutureCode = undefined
      store.addPosition({ secid, type, quantity: 2, price: 100, nettedIm: true })
      const valuation_context = { ...context, underlying_secid: secid, underlying_price: 110 }
      calculate.mockResolvedValue({ ...portfolio(), valuation_context })
      getGraph.mockResolvedValue({
        now: [{ underlying_price: 110, value: 10 }],
        on_expiration: [{ underlying_price: 110, value: 10 }],
        valuation_context,
      })
      vi.mocked(getInstrumentSpecification).mockResolvedValue({
        secid,
        price: 110,
        source: 'MIDPOINT',
        minStep: 0.01,
        stepPrice: 0.01 * lotSize,
        lotSize,
      })
      await store.calculate()
      expect(calculate).toHaveBeenCalledWith(
        expect.objectContaining({
          positions: expect.arrayContaining([expect.objectContaining({ secid, type })]),
        }),
        expect.anything(),
      )
      expect(store.calculation.portfolio?.positions).toHaveLength(2)
      expect(store.calculation.portfolio?.total.profit_and_loss).toBe(10 + 20 * lotSize)
      expect(store.calculation.graphs.profit_and_loss?.now[0]?.value).toBe(10 + 20 * lotSize)
    },
  )
  it('creates the initial and subsequent strategy without a selected underlying', () => {
    const store = usePortfolioStore()
    expect(store.activeStrategy).toMatchObject({ assetCode: '', assetType: null, positions: [] })
    store.addStrategy()
    expect(store.activeStrategy).toMatchObject({ assetCode: '', assetType: null, positions: [] })
    expect(calculate).not.toHaveBeenCalled()
  })

  it('starts only portfolio and the selected profile graph, using Rust spot without board/ISS', async () => {
    const store = populatedStore()
    const pendingPortfolio = deferred<CalculatedPortfolio>()
    const pendingGraph = deferred<IndicatorGraph>()
    calculate.mockReturnValueOnce(pendingPortfolio.promise)
    getGraph.mockReturnValueOnce(pendingGraph.promise)
    const run = store.calculate()
    expect(calculate).toHaveBeenCalledTimes(1)
    expect(getGraph.mock.calls.map(([indicator]) => indicator)).toEqual(['profit_and_loss'])
    expect(getBoard).not.toHaveBeenCalled()

    pendingPortfolio.resolve(portfolio())
    await flushPromises()
    expect(store.calculation.loading).toBe(false)
    expect(store.calculation.portfolio?.total.profit_and_loss).toBe(10)
    expect(store.activeStrategy?.marketPrice).toBe(86_000)
    expect(store.calculation.graphLoading.profit_and_loss).toBe(true)
    pendingGraph.resolve(graph())
    await run
    expect(store.calculation.graphs.profit_and_loss?.now).toEqual(graph().now)
    expect(store.calculation.portfolio?.valuation_context).toEqual(context)
    expect(getBoard).not.toHaveBeenCalled()
    expect(getPrice).not.toHaveBeenCalled()
    expect(getGraph).toHaveBeenCalledTimes(1)
  })

  it('loads a Greek on selection, coalesces repeated choices, and keeps the ready P&L', async () => {
    const store = populatedStore()
    await store.calculate()
    const pendingGamma = deferred<IndicatorGraph>()
    getGraph.mockReturnValueOnce(pendingGamma.promise)
    store.selectedIndicator = 'gamma'
    await nextTick()
    const first = store.loadGraph('gamma')
    const second = store.loadGraph('gamma')
    expect(getGraph.mock.calls.map(([indicator]) => indicator)).toEqual([
      'profit_and_loss',
      'gamma',
    ])
    expect(store.calculation.graphs.profit_and_loss?.now).toEqual(graph().now)
    expect(store.calculation.error).toBeNull()
    pendingGamma.resolve(graph(0.001))
    await Promise.all([first, second])
    expect(store.calculation.graphs.gamma?.now[1]?.value).toBe(0.001)
    await store.loadGraph('gamma')
    expect(getGraph).toHaveBeenCalledTimes(2)
  })

  it('does not request profile graphs while the profile tab is hidden', async () => {
    const store = populatedStore()
    store.profileVisible = false
    await store.calculate()
    expect(calculate).toHaveBeenCalledTimes(1)
    expect(getGraph).not.toHaveBeenCalled()
    store.selectedIndicator = 'theta'
    store.profileVisible = true
    await nextTick()
    await store.loadGraph('theta')
    expect(getGraph.mock.calls.map(([indicator]) => indicator)).toEqual(['theta'])
  })

  it('retains the official MOEX board/ISS path only when portfolio context is absent', async () => {
    const legacy = portfolio()
    delete legacy.valuation_context
    calculate.mockResolvedValue(legacy)
    getBoard.mockResolvedValue({ rows: [], valuationContext: null })
    getPrice.mockResolvedValue({ secid: 'SiZ6', price: 85_990, source: 'LAST' })
    const store = populatedStore()
    await store.calculate()
    expect(getBoard).toHaveBeenCalledWith('SI', 'SI-SERIES', 'futures', {
      signal: expect.any(AbortSignal),
    })
    expect(getPrice).toHaveBeenCalledWith('SiZ6', { signal: expect.any(AbortSignal) })
    expect(store.activeStrategy?.marketPrice).toBe(85_990)
    expect(store.calculation.error).toBeNull()
  })

  it.each([
    null,
    {},
    { underlying_price: 0, underlying_secid: 'SiZ6' },
    { underlying_price: Number.NaN, underlying_secid: 'SiZ6' },
    { underlying_price: 86_000 },
  ])('reports invalid explicit context %j instead of substituting spot', async (invalid) => {
    calculate.mockResolvedValue({ ...portfolio(), valuation_context: invalid })
    const store = populatedStore()
    await store.calculate()
    expect(store.calculation.error).toContain('valuation_context')
    expect(store.calculation.portfolio).toBeNull()
    expect(store.activeStrategy?.marketPrice).toBeNull()
    expect(store.calculation.graphs).toEqual({})
    expect(getBoard).not.toHaveBeenCalled()
    expect(getPrice).not.toHaveBeenCalled()
  })

  it.each([
    ['profit_and_loss', 'PnL', null],
    ['delta', 'Delta', undefined],
    ['gamma', 'Gamma', {}],
    ['vega', 'Vega', { now: null, on_expiration: [] }],
    ['theta', 'Theta', { ...graph(), now: [null] }],
    [
      'rho',
      'Rho',
      { ...graph(), on_expiration: [{ underlying_price: 86_000, value: Number.NaN }] },
    ],
    ['gamma', 'Gamma', { ...graph(), on_what_if: {} }],
    ['theta', 'Theta', { ...graph(), on_what_if: [null] }],
    ['vega', 'Vega', { ...graph(), now: [] }],
  ])(
    'logs invalid %s graph without a synthetic graph or global UI error',
    async (indicator, label, invalid) => {
      const store = populatedStore()
      store.selectedIndicator = indicator as IndicatorType
      getGraph.mockResolvedValue(invalid as IndicatorGraph)
      await store.calculate()
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(`[MOEX Options] ${label} chart error:`),
      )
      expect(store.calculation.graphs[indicator as IndicatorType]).toBeUndefined()
      expect(store.calculation.error).toBeNull()
      expect(store.calculation.portfolio?.total.profit_and_loss).toBe(10)
    },
  )

  it.each(['resolve', 'reject'] as const)(
    'ignores late %s from a cancelled strategy, including its errors',
    async (outcome) => {
      const oldPortfolio = deferred<CalculatedPortfolio>()
      const oldGraph = deferred<IndicatorGraph>()
      calculate.mockReturnValueOnce(oldPortfolio.promise)
      getGraph.mockReturnValueOnce(oldGraph.promise)
      const store = populatedStore()
      const oldStrategy = store.activeStrategy!
      const oldRun = store.calculate()
      const oldSignal = calculate.mock.calls[0]![1]!.signal!
      store.addStrategy()
      store.activeStrategy!.assetCode = 'SBRF'
      store.activeStrategy!.assetType = 'futures'
      store.addPosition({
        secid: 'SR-CALL',
        type: 'option',
        quantity: 1,
        price: 100,
        nettedIm: true,
      })
      calculate.mockResolvedValueOnce({
        ...portfolio(),
        valuation_context: { ...context, underlying_price: 28_000, underlying_secid: 'SRZ6' },
      })
      await store.calculate()
      expect(oldSignal.aborted).toBe(true)
      if (outcome === 'reject') {
        oldPortfolio.reject(new Error('old portfolio failed'))
        oldGraph.reject(new Error('old graph failed'))
      } else {
        oldPortfolio.resolve(portfolio())
        oldGraph.resolve(graph(999))
      }
      await oldRun
      expect(store.activeStrategy?.marketPrice).toBe(28_000)
      expect(oldStrategy.marketPrice).toBeNull()
      expect(store.calculation.graphs.profit_and_loss?.now[1]?.value).toBe(10)
      expect(store.calculation.error).toBeNull()
      expect(console.error).not.toHaveBeenCalled()
    },
  )

  it.each(['IV shift', 'saved date'])(
    'keeps current totals after late scenario graphs: %s',
    async (scenario) => {
      const store = populatedStore()
      if (scenario === 'IV shift') store.activeStrategy!.volatilityShift = 1
      else store.activeStrategy!.calculationDate = '2026-09-17'
      const current = portfolio()
      current.total = {
        profit_and_loss: 10,
        profit_and_loss_rub: 30,
        delta: 0.5,
        gamma: 0.002,
        vega: 8,
        theta: -3,
        rho: 1,
      }
      calculate.mockResolvedValue(current)
      const pending = deferred<IndicatorGraph>()
      getGraph.mockImplementation((indicator) => {
        if (indicator === 'profit_and_loss') return pending.promise
        return Promise.resolve({ ...graph(), on_what_if: graph(99).now })
      })
      const run = store.calculate()
      await flushPromises()
      expect(store.calculation.portfolio?.total).toEqual(current.total)
      expect(store.calculation.loading).toBe(false)
      pending.resolve({ ...graph(), on_what_if: graph(20).now })
      await run
      expect(store.calculation.portfolio?.total).toEqual(current.total)
      expect(store.calculation.graphs.profit_and_loss?.now[1]?.value).toBe(
        current.total.profit_and_loss,
      )
      expect(store.calculation.graphs.profit_and_loss?.on_what_if?.[1]?.value).toBe(20)
      expect(calculate.mock.calls[0]![0].what_if).toBeUndefined()
      expect(getGraph.mock.calls[0]![1].what_if).toBeDefined()
      expect(getGraph).toHaveBeenCalledTimes(1)
      for (const indicator of ['delta', 'gamma', 'vega', 'theta', 'rho'] as IndicatorType[]) {
        store.selectedIndicator = indicator
        await flushPromises()
        await store.loadGraph(indicator)
        expect(store.calculation.graphs[indicator]?.on_what_if?.[1]?.value).toBe(99)
        expect(store.calculation.portfolio?.total).toEqual(current.total)
      }
    },
  )
})
