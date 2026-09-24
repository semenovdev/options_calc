import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import { optionCalcApi } from '@/api/optionCalc'
import { MoexApiError } from '@/api/http'
import { usePortfolioStore } from '@/stores/portfolio'
import type { OptionSeries, VolatilityPoint } from '@/types/moex'

import MarketWorkspace from './MarketWorkspace.vue'

vi.mock('@/api/optionCalc', () => ({
  optionCalcApi: { getSeries: vi.fn(), getOptionBoard: vi.fn(), getVolatilityGraph: vi.fn() },
}))

const getSeries = vi.mocked(optionCalcApi.getSeries)
const getBoard = vi.mocked(optionCalcApi.getOptionBoard)
const getSmile = vi.mocked(optionCalcApi.getVolatilityGraph)
const Chart = defineComponent({
  name: 'TestChart',
  props: { option: { type: Object, required: true } },
  template: '<div class="rendered-chart" />',
})
const seriesFor = (asset: string, suffix = 'A'): OptionSeries => ({
  asset_code: asset,
  asset_type: 'futures',
  optionseries_code: `${asset}-${suffix}`,
  expiration_date: '2099-12-31',
  futures_code: `${asset}-FUTURE`,
})
const points = [
  { strike: 85_000, volatility: 20 },
  { strike: 86_000, volatility: 21 },
]

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

let pinia: Pinia
let wrapper: VueWrapper | undefined
beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  pinia = createPinia()
  setActivePinia(pinia)
  const store = usePortfolioStore()
  store.activeStrategy!.assetCode = 'SI'
  store.activeStrategy!.assetType = 'futures'
  store.addPosition({
    secid: 'SI-CALL',
    type: 'option',
    price: 100,
    quantity: 1,
    nettedIm: true,
    expirationDate: '2099-12-31',
    optionSeriesCode: 'SI-A',
    underlyingFutureCode: 'SI-FUTURE',
  })
  getSeries.mockImplementation(async (asset) => [seriesFor(asset), seriesFor(asset, 'B')])
  getSmile.mockResolvedValue(points)
  getBoard.mockResolvedValue({
    valuationContext: null,
    rows: [{ secid: 'SI-CALL', strike: 85_000, bid: 100, offer: 102, numtrades: 4 }],
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  disposePinia(pinia)
  vi.restoreAllMocks()
})

function render() {
  wrapper = mount(MarketWorkspace, { global: { plugins: [pinia], components: { VChart: Chart } } })
  return wrapper
}

async function tab(label: string) {
  await wrapper!
    .findAll('.workspace-tabs button')
    .find((button) => button.text() === label)!
    .trigger('click')
  await flushPromises()
}

describe('workspace request boundaries', () => {
  it.each(['rust', 'legacy'])('shows a warning for insufficient %s smile data', async (backend) => {
    if (backend === 'rust')
      getSmile.mockRejectedValueOnce(
        new MoexApiError('sparse wings', 503, {
          code: 'LIVE_DATA_UNAVAILABLE',
          details: { reason: 'INSUFFICIENT_VOLATILITY_DATA' },
        }),
      )
    else getSmile.mockResolvedValueOnce([])
    render()
    await tab('Улыбка IV')
    expect(wrapper!.get('[role="status"]').text()).toContain('Недостаточно данных')
    expect(wrapper!.find('[data-testid="smile-chart"]').exists()).toBe(false)
    expect(console.error).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
    await wrapper!.get('.series-select').setValue('SI-B')
    await flushPromises()
    expect(wrapper!.find('.smile-warning').exists()).toBe(false)
    expect(wrapper!.find('[data-testid="smile-chart"]').exists()).toBe(true)
  })

  it('does not turn provider or calculation errors into a sparse-data warning', async () => {
    getSmile.mockRejectedValueOnce(
      new MoexApiError('invalid curve', 503, {
        code: 'LIVE_DATA_UNAVAILABLE',
        details: {},
      }),
    )
    render()
    await tab('Улыбка IV')
    expect(wrapper!.find('.smile-warning').exists()).toBe(false)
    expect(console.error).toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
  })
  it('makes no catalog, board or smile requests on the default profile tab', async () => {
    render()
    await flushPromises()
    expect(getSeries).not.toHaveBeenCalled()
    expect(getBoard).not.toHaveBeenCalled()
    expect(getSmile).not.toHaveBeenCalled()
    expect(usePortfolioStore().profileVisible).toBe(true)
  })

  it('loads only the smile on its tab and only the board on liquidity', async () => {
    getSmile.mockImplementation(async (_asset, _series, _type, options) => {
      options?.onValuationMode?.('settlement')
      return points
    })
    render()
    await tab('Улыбка IV')
    expect(getSeries).toHaveBeenCalledTimes(1)
    expect(getSmile).toHaveBeenCalledWith('SI', 'SI-A', 'futures', {
      signal: expect.any(AbortSignal),
      onValuationMode: expect.any(Function),
    })
    await flushPromises()
    expect(wrapper!.find('.smile-source').text()).toBe('Улыбка — расчётные цены')
    expect(getBoard).not.toHaveBeenCalled()
    expect(wrapper!.find('[data-testid="smile-chart"]').exists()).toBe(true)
    expect(wrapper!.findComponent(Chart).props('option').series[0].data).toEqual([
      [85_000, 20],
      [86_000, 21],
    ])

    await tab('Ликвидность')
    expect(getSeries).toHaveBeenCalledTimes(1)
    expect(getSmile).toHaveBeenCalledTimes(1)
    expect(getBoard).toHaveBeenCalledTimes(1)
    expect(getBoard).toHaveBeenCalledWith('SI', 'SI-A', 'futures', {
      signal: expect.any(AbortSignal),
    })
    expect(wrapper!.find('.liquidity-table').text()).toContain('SI-CALL')
  })

  it('cancels an old smile on tab change and ignores its late rejection', async () => {
    const pending = deferred<VolatilityPoint[]>()
    getSmile.mockReturnValueOnce(pending.promise)
    render()
    await tab('Улыбка IV')
    const signal = getSmile.mock.calls[0]![3]!.signal!
    await tab('Ликвидность')
    expect(signal.aborted).toBe(true)
    pending.reject(new Error('late smile failure'))
    await flushPromises()
    expect(wrapper!.find('.liquidity-table').exists()).toBe(true)
    expect(wrapper!.find('.inline-error').exists()).toBe(false)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('never combines the previous asset series with a newly selected asset', async () => {
    const pending = deferred<VolatilityPoint[]>()
    getSmile.mockReturnValueOnce(pending.promise)
    render()
    await tab('Улыбка IV')
    const signal = getSmile.mock.calls[0]![3]!.signal!
    const store = usePortfolioStore()
    store.addStrategy()
    store.activeStrategy!.assetCode = 'SBRF'
    store.activeStrategy!.assetType = 'futures'
    await flushPromises()
    expect(signal.aborted).toBe(true)
    expect(getSmile.mock.calls.map(([asset, series]) => [asset, series])).toEqual([
      ['SI', 'SI-A'],
      ['SBRF', 'SBRF-A'],
    ])
    pending.resolve([{ strike: 1, volatility: 999 }])
    await flushPromises()
    expect(wrapper!.findComponent(Chart).props('option').series[0].data).toEqual([
      [85_000, 20],
      [86_000, 21],
    ])
    expect(wrapper!.find<HTMLSelectElement>('.series-select').element.value).toBe('SBRF-A')
    expect(console.error).not.toHaveBeenCalled()
  })

  it('cancels the previous series request and does not render its late data', async () => {
    const pending = deferred<VolatilityPoint[]>()
    getSmile.mockReturnValueOnce(pending.promise)
    render()
    await tab('Улыбка IV')
    const signal = getSmile.mock.calls[0]![3]!.signal!
    await wrapper!.get('.series-select').setValue('SI-B')
    await flushPromises()
    expect(signal.aborted).toBe(true)
    expect(getSmile.mock.calls.map(([, series]) => series)).toEqual(['SI-A', 'SI-B'])
    pending.resolve([{ strike: 1, volatility: 999 }])
    await flushPromises()
    expect(wrapper!.findComponent(Chart).props('option').series[0].data).toEqual([
      [85_000, 20],
      [86_000, 21],
    ])
  })

  it.each(['profile', 'unmount'])(
    'cancels catalog loading on %s without starting follow-up data requests',
    async (action) => {
      const pending = deferred<OptionSeries[]>()
      getSeries.mockReturnValueOnce(pending.promise)
      render()
      await tab('Улыбка IV')
      const signal = getSeries.mock.calls[0]![2]!.signal!
      if (action === 'profile') await tab('Профиль')
      else {
        wrapper!.unmount()
        wrapper = undefined
      }
      expect(signal.aborted).toBe(true)
      pending.resolve([seriesFor('SI')])
      await flushPromises()
      expect(getSmile).not.toHaveBeenCalled()
      expect(getBoard).not.toHaveBeenCalled()
      expect(console.error).not.toHaveBeenCalled()
    },
  )

  it('aborts an in-flight board on unmount', async () => {
    const pending = deferred<Awaited<ReturnType<typeof optionCalcApi.getOptionBoard>>>()
    getBoard.mockReturnValueOnce(pending.promise)
    render()
    await tab('Ликвидность')
    const signal = getBoard.mock.calls[0]![3]!.signal!
    wrapper!.unmount()
    wrapper = undefined
    expect(signal.aborted).toBe(true)
    pending.reject(new Error('late board error'))
    await flushPromises()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('logs an invalid smile without a global/inline UI error', async () => {
    getSmile.mockResolvedValue([{ strike: 85_000, volatility: Number.NaN }])
    render()
    await tab('Улыбка IV')
    expect(console.error).toHaveBeenCalledWith(
      '[MOEX Options] IV Smile chart error:',
      expect.any(Error),
    )
    expect(wrapper!.find('[data-testid="smile-chart"]').exists()).toBe(false)
    expect(wrapper!.find('.inline-error').exists()).toBe(false)
  })
})
