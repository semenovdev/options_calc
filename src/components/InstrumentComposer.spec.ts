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
