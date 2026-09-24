import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { optionCalcApi } from '@/api/optionCalc'
import type { Asset, Future } from '@/types/moex'

import InstrumentComposer from './InstrumentComposer.vue'

vi.mock('@/api/optionCalc', () => ({
  optionCalcApi: {
    searchAssets: vi.fn(),
    getFutures: vi.fn(),
    getSeries: vi.fn(),
    getOptionBoard: vi.fn(),
  },
}))

const search = vi.mocked(optionCalcApi.searchAssets)
const futures = vi.mocked(optionCalcApi.getFutures)
const asset = (code: string): Asset => ({
  asset_code: code,
  asset_type: 'futures',
  title: `${code} futures`,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

let pinia: Pinia
let wrapper: VueWrapper | undefined
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn()
  localStorage.clear()
  vi.resetAllMocks()
  vi.useFakeTimers()
  pinia = createPinia()
  setActivePinia(pinia)
  futures.mockResolvedValue([])
  vi.mocked(optionCalcApi.getSeries).mockResolvedValue([])
  wrapper = mount(InstrumentComposer, {
    props: { open: true },
    global: { plugins: [pinia], stubs: { Teleport: true, Transition: false } },
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  disposePinia(pinia)
  vi.useRealTimers()
})

async function query(value: string) {
  await wrapper!
    .get('input[placeholder="Тикер или название, например SBER или Si"]')
    .setValue(value)
  await vi.advanceTimersByTimeAsync(250)
  await flushPromises()
}

describe('composer cancellation', () => {
  it('offers direct IMOEX options and separately finds the MIX index future', async () => {
    search.mockImplementation(async (needle) =>
      needle === 'MIX'
        ? [{ asset_code: 'MIX', title: 'MIX', asset_type: 'futures', asset_subtype: 'commodity' }]
        : [{ asset_code: 'IMOEX', title: 'IMOEX', asset_type: 'share', asset_subtype: 'index' }],
    )
    futures.mockResolvedValue([{ futures_code: 'MXZ6', expiration_date: '2099-12-17' }])
    vi.mocked(optionCalcApi.getSeries).mockResolvedValue([
      {
        optionseries_code: 'IMOEX-share-IMOEX-2026-09-30',
        asset_code: 'IMOEX',
        asset_type: 'share',
        futures_code: 'IMOEX',
        expiration_date: '2099-09-30',
      },
    ])
    vi.mocked(optionCalcApi.getOptionBoard).mockResolvedValue({
      valuationContext: {
        mode: 'market',
        underlying_price: 2312,
        underlying_secid: 'IMOEX',
      },
      rows: [],
    })
    await query('IMOEX')
    expect(wrapper!.get('.asset-results').text()).toContain('Индекс')
    expect(wrapper!.get('.asset-results').text()).toContain('MIX')
    expect(wrapper!.get('.asset-results').text()).toContain('Фьючерс')
    expect(search).toHaveBeenCalledWith('MIX', 'futures', expect.anything())
    expect(futures).toHaveBeenCalledWith('MIX', undefined, expect.anything())
    expect(futures).not.toHaveBeenCalledWith('IMOEX', undefined, expect.anything())
    await wrapper!
      .findAll('.asset-results button')
      .find((button) => button.text().includes('IMOEX'))!
      .trigger('click')
    await flushPromises()
    expect(optionCalcApi.getSeries).toHaveBeenCalledWith('IMOEX', 'share', {
      signal: expect.any(AbortSignal),
    })
    expect(optionCalcApi.getOptionBoard).toHaveBeenCalled()
    expect(wrapper!.get('select').exists()).toBe(true)
    const futureButton = wrapper!.findAll('button').find((button) => button.text() === 'Фьючерс')!
    expect(futureButton.attributes('disabled')).toBeUndefined()
    await futureButton.trigger('click')
    await flushPromises()
    expect(wrapper!.get('h2').text()).toBe('MIX')
    expect(wrapper!.text()).toContain('MXZ6')
    expect(futures).not.toHaveBeenCalledWith('IMOEX', undefined, expect.anything())
  })

  it('uses MIX rather than IMOEX when the index future is selected', async () => {
    search.mockImplementation(async (needle) =>
      needle === 'MIX'
        ? [{ asset_code: 'MIX', title: 'MIX', asset_type: 'futures' }]
        : [{ asset_code: 'IMOEX', title: 'IMOEX', asset_type: 'share', asset_subtype: 'index' }],
    )
    futures.mockResolvedValue([{ futures_code: 'MXZ6', expiration_date: '2099-12-17' }])
    await query('IMOEX')
    await wrapper!
      .findAll('.asset-results button')
      .find((button) => button.text().includes('MIX'))!
      .trigger('click')
    await flushPromises()
    expect(wrapper!.get('h2').text()).toBe('MIX')
    expect(futures).not.toHaveBeenCalledWith('IMOEX', undefined, expect.anything())
    expect(wrapper!.text()).toContain('MXZ6')
  })

  it.each(['index', 'commodity'] as const)(
    'does not offer a %s underlying as a share position',
    async (subtype) => {
      search.mockResolvedValue([
        {
          asset_code: 'DIRECT',
          title: 'Direct underlying',
          asset_type: 'share',
          asset_subtype: subtype,
        },
      ])
      await query('DIRECT')
      await wrapper!.get('.asset-results button').trigger('click')
      await flushPromises()
      expect(wrapper!.findAll('button').some((button) => button.text() === 'Акция')).toBe(false)
      const button = wrapper!
        .findAll('button')
        .find((button) => button.text() === (subtype === 'index' ? 'Индекс' : 'Металл'))!
      expect(button.attributes('disabled') !== undefined).toBe(subtype === 'index')
    },
  )
  it('does not label wide spreads and one-sided offers as theoretical-only', async () => {
    search.mockResolvedValue([asset('GAZR')])
    vi.mocked(optionCalcApi.getSeries).mockResolvedValue([
      {
        optionseries_code: 'GAZR-test',
        asset_code: 'GAZR',
        asset_type: 'futures',
        expiration_date: '2099-09-30',
        futures_code: 'GZZ6',
      },
    ])
    vi.mocked(optionCalcApi.getOptionBoard).mockResolvedValue({
      valuationContext: {
        mode: 'market',
        underlying_price: 10510.5,
        underlying_secid: 'GZZ6',
        as_of: '2026-09-24T15:00:00Z',
      },
      rows: [
        {
          secid: 'GZ11000BJ6A',
          option_type: 'call',
          strike: 11000,
          bid: 10,
          offer: 90,
          theorprice: 50,
        },
        {
          secid: 'GZ11250BJ6A',
          option_type: 'call',
          strike: 11250,
          bid: null,
          offer: 93,
          theorprice: null,
          model_price: null,
          settlement_price: 63,
          underlying_source: 'market',
        },
      ],
    })
    await query('GAZR')
    await wrapper!.get('.asset-results button').trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Спред 160%')
    expect(wrapper!.text()).toContain('Только OFFER')
    expect(wrapper!.text()).not.toContain('Только расчётная цена')
    expect(wrapper!.text()).toContain('93')
    const row = wrapper!
      .findAll('.strike-list button')
      .find((item) => item.text().includes('GZ11250BJ6A'))!
    expect(row.get('.reference-price').text()).toContain('Расчёт (поставщик)')
    expect(row.get('.reference-price strong').text()).toBe('63')
  })

  it('does not fetch futures for every result of a broad search', async () => {
    search.mockResolvedValue([asset('SI'), asset('SBRF'), asset('SNGP')])
    await query('S')
    expect(wrapper!.findAll('.result-code')).toHaveLength(3)
    expect(futures).not.toHaveBeenCalled()
  })
  it('cancels superseded searches and ignores their late results', async () => {
    const oldSearch = deferred<Asset[]>()
    search.mockReturnValueOnce(oldSearch.promise).mockResolvedValueOnce([asset('RTS')])
    await query('SI')
    const signal = search.mock.calls[0]![2]!.signal!
    await query('RTS')
    expect(signal.aborted).toBe(true)
    oldSearch.resolve([asset('SI')])
    await flushPromises()
    expect(wrapper!.findAll('.result-code').map((item) => item.text())).toEqual(['RTS'])
    expect(futures.mock.calls.map(([code]) => code)).toEqual(['RTS'])
  })

  it.each(['close', 'unmount'])(
    'cancels search on %s and never starts futures loading for its late result',
    async (action) => {
      const oldSearch = deferred<Asset[]>()
      search.mockReturnValueOnce(oldSearch.promise)
      await query('SI')
      const signal = search.mock.calls[0]![2]!.signal!
      if (action === 'close') await wrapper!.get('button[title="Закрыть"]').trigger('click')
      else {
        wrapper!.unmount()
        wrapper = undefined
      }
      expect(signal.aborted).toBe(true)
      oldSearch.resolve([asset('SI')])
      await flushPromises()
      expect(futures).not.toHaveBeenCalled()
    },
  )

  it('cancels pending search-futures enrichment when an asset is selected', async () => {
    search.mockResolvedValueOnce([asset('SI')])
    const pendingFutures = deferred<Future[]>()
    futures.mockReturnValueOnce(pendingFutures.promise)
    await query('SI')
    const signal = futures.mock.calls[0]![2]!.signal!
    await wrapper!.get('.asset-results button').trigger('click')
    await flushPromises()
    expect(signal.aborted).toBe(true)
    expect(optionCalcApi.getSeries).toHaveBeenCalledWith('SI', 'futures', {
      signal: expect.any(AbortSignal),
    })
    pendingFutures.resolve([{ futures_code: 'OLD-FUTURE' }])
    await flushPromises()
    expect(wrapper!.get('h2').text()).toBe('SI futures')
    expect(wrapper!.text()).not.toContain('OLD-FUTURE')
  })
})
