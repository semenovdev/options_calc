import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { optionCalcApi } from '@/api/optionCalc'
import { MoexApiError } from '@/api/http'
import { usePortfolioStore } from '@/stores/portfolio'
import App from './App.vue'

vi.mock('@/api/optionCalc', () => ({
  optionCalcApi: {
    calculatePortfolio: vi.fn(),
    getPortfolioGraph: vi.fn(),
    getOptionBoard: vi.fn(),
  },
}))

let pinia: Pinia
let wrapper: VueWrapper | undefined
beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  pinia = createPinia()
  setActivePinia(pinia)
  const store = usePortfolioStore()
  store.activeStrategy!.assetCode = 'SI'
  store.activeStrategy!.assetType = 'futures'
  store.addPosition({ secid: 'SI-CALL', type: 'option', price: 100, quantity: 1, nettedIm: true })
  vi.mocked(optionCalcApi.calculatePortfolio).mockResolvedValue({
    positions: [],
    total: {},
    valuation_context: { underlying_price: 86_000, underlying_secid: 'SiZ6' },
  })
  vi.mocked(optionCalcApi.getPortfolioGraph).mockResolvedValue({
    now: [{ underlying_price: 86_000, value: 10 }],
    on_expiration: [{ underlying_price: 86_000, value: 5 }],
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  disposePinia(pinia)
  vi.restoreAllMocks()
})

function render() {
  wrapper = mount(App, {
    global: {
      plugins: [pinia],
      stubs: {
        InstrumentComposer: true,
        MarketWorkspace: true,
        PositionTable: true,
        StrategyRail: true,
        SummaryPanel: true,
      },
    },
  })
  return wrapper
}

describe('application calculation lifecycle', () => {
  it('shows missing quotes as a status warning, not an error, and clears it after recovery', async () => {
    vi.mocked(optionCalcApi.calculatePortfolio).mockRejectedValueOnce(
      new MoexApiError(
        'Neither market nor settlement valuation context is complete: market: missing market price for S2170CX6; settlement: missing settlement price for SLVRUB_TOM',
        503,
        { code: 'LIVE_DATA_UNAVAILABLE' },
      ),
    )
    render()
    await flushPromises()
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper!.get('.warning-banner[role="status"]').text()).toContain('котировок')
    expect(wrapper!.text()).not.toContain('Neither market')
    await usePortfolioStore().calculate()
    await flushPromises()
    expect(wrapper!.find('.warning-banner').exists()).toBe(false)
  })

  it('does not show an asset badge for a new strategy', () => {
    const store = usePortfolioStore()
    store.addStrategy()
    render()
    expect(wrapper!.find('.asset-badge').exists()).toBe(false)
  })

  it('recalculates a populated strategy on mount and switching back from an empty strategy', async () => {
    const store = usePortfolioStore()
    const firstId = store.activeId
    render()
    await flushPromises()
    expect(optionCalcApi.calculatePortfolio).toHaveBeenCalledTimes(1)
    store.addStrategy()
    await flushPromises()
    expect(optionCalcApi.calculatePortfolio).toHaveBeenCalledTimes(1)
    store.selectStrategy(firstId)
    await flushPromises()
    expect(optionCalcApi.calculatePortfolio).toHaveBeenCalledTimes(2)
  })

  it('shows a visible calculation error for a null Rust valuation context', async () => {
    vi.mocked(optionCalcApi.calculatePortfolio).mockResolvedValue({
      positions: [],
      total: {},
      valuation_context: null,
    })
    render()
    await flushPromises()
    expect(wrapper!.get('[role="alert"]').text()).toContain('valuation_context')
    expect(optionCalcApi.getOptionBoard).not.toHaveBeenCalled()
    expect(usePortfolioStore().activeStrategy?.marketPrice).toBeNull()
  })
})
