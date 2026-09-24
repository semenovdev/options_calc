import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { optionCalcApi } from '@/api/optionCalc'
import { usePortfolioStore } from '@/stores/portfolio'
import type { Asset, InstrumentType } from '@/types/moex'

import InstrumentComposer from './InstrumentComposer.vue'

vi.mock('@/config', () => ({ appConfig: { backend: 'rust' } }))
vi.mock('@/api/optionCalc', () => ({
  optionCalcApi: {
    searchAssets: vi.fn(),
    getSeries: vi.fn(),
    getOptionBoard: vi.fn(),
    getFutures: vi.fn(),
    getInstrument: vi.fn(),
    calculatePortfolio: vi.fn(),
    getPortfolioGraph: vi.fn(),
  },
}))

const cases: { asset: Asset; secid: string; type: InstrumentType; tab: string }[] = [
  ...[
    ['SI', 'SiZ6', 'currency'],
    ['SBRF', 'SRZ6', 'share'],
    ['GAZR', 'GZZ6', 'share'],
    ['RTS', 'RIZ6', 'index'],
    ['MIX', 'MXZ6', 'index'],
    ['GOLD', 'GDZ6', 'commodity'],
    ['SILV', 'SVZ6', 'commodity'],
    ['BR', 'BRV6', 'commodity'],
  ].map(([code, secid, subtype]) => ({
    asset: {
      asset_code: code!,
      title: code!,
      asset_type: 'futures' as const,
      asset_subtype: subtype as Asset['asset_subtype'],
    },
    secid: secid!,
    type: 'futures' as const,
    tab: 'Фьючерс',
  })),
  ...[
    ['SBER', 'share', 'Акция'],
    ['ROSN', 'share', 'Акция'],
    ['SMLT', 'share', 'Акция'],
    ['GLDRUB_TOM', 'commodity', 'Металл'],
    ['SLVRUB_TOM', 'commodity', 'Металл'],
    ['CNYRUB_TOM', 'currency', 'Валюта'],
  ].map(([code, type, tab]) => ({
    asset: {
      asset_code: code!,
      title: code!,
      asset_type: 'share' as const,
      asset_subtype: type as Asset['asset_subtype'],
    },
    secid: code!,
    type: type as InstrumentType,
    tab: tab!,
  })),
]

let pinia: Pinia
let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  localStorage.clear()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => {
  wrapper?.unmount()
  disposePinia(pinia)
  vi.useRealTimers()
})

describe.each(['pending', 'saved', 'reloaded'] as const)(
  'option + underlying: %s strategy',
  (stage) => {
    it.each(cases)(
      '$asset.asset_code adds $type without changing the option underlying',
      async ({ asset, secid, type, tab }) => {
        const series = {
          optionseries_code: `${asset.asset_code}-series`,
          asset_code: asset.asset_code,
          asset_type: asset.asset_type,
          futures_code: secid,
          expiration_date: '2099-10-01',
        }
        vi.mocked(optionCalcApi.searchAssets).mockResolvedValue([asset])
        vi.mocked(optionCalcApi.getSeries).mockResolvedValue([series])
        vi.mocked(optionCalcApi.getOptionBoard).mockResolvedValue({
          valuationContext: { underlying_secid: secid, underlying_price: 100, mode: 'market' },
          rows: [{ secid: 'CALL', strike: 100, option_type: 'call', bid: 9, offer: 10 }],
        })
        const quote = {
          asset_code: asset.asset_code,
          price: 100,
          price_source: 'midpoint',
          min_step: 0.01,
          step_price: 1,
          lot_size: 100,
        }
        vi.mocked(optionCalcApi.getFutures).mockResolvedValue([
          { ...quote, futures_code: secid, expiration_date: '2099-12-01' },
          { ...quote, futures_code: 'OTHER', expiration_date: '2100-01-01' },
        ])
        vi.mocked(optionCalcApi.getInstrument).mockResolvedValue({ ...quote, secid })
        let store = usePortfolioStore()
        if (stage !== 'pending') {
          store.activeStrategy!.assetCode = asset.asset_code
          store.activeStrategy!.assetType = asset.asset_type
          store.addPosition({
            secid: 'CALL',
            type: 'option',
            quantity: 1,
            price: 10,
            nettedIm: true,
            optionSeriesCode: series.optionseries_code,
            expirationDate: series.expiration_date,
            // Direct underlyings were previously persisted in this field too.
            underlyingFutureCode: secid,
          })
          await flushPromises()
          if (stage === 'reloaded') {
            disposePinia(pinia)
            pinia = createPinia()
            setActivePinia(pinia)
            store = usePortfolioStore()
          }
        }
        vi.spyOn(store, 'calculate').mockResolvedValue(undefined)
        wrapper = mount(InstrumentComposer, {
          props: { open: false, useActiveAsset: stage !== 'pending' },
          global: { plugins: [pinia], stubs: { Teleport: true, Transition: false } },
        })
        await wrapper.setProps({ open: true })
        await flushPromises()
        if (stage === 'pending') {
          await wrapper
            .get('input[placeholder="Тикер или название, например SBER или Si"]')
            .setValue(asset.asset_code)
          await vi.advanceTimersByTimeAsync(250)
          await flushPromises()
          await wrapper
            .findAll('.asset-results button')
            .find((b) => b.find('.result-code').text() === asset.asset_code)!
            .trigger('click')
          await flushPromises()
          await wrapper.get('.strike-list button').trigger('click')
          await wrapper
            .findAll('button')
            .find((b) => b.text() === 'Добавить позицию')!
            .trigger('click')
        }
        const tabButton = wrapper.findAll('button').find((b) => b.text() === tab)!
        expect(tabButton, `missing ${tab} tab`).toBeDefined()
        expect(tabButton.attributes('disabled')).toBeUndefined()
        await tabButton.trigger('click')
        await flushPromises()
        if (type === 'futures') {
          expect(wrapper.findAll('.futures-list button')).toHaveLength(1)
          expect(wrapper.get('.futures-list button').text()).toContain(secid)
          await wrapper.get('.futures-list button').trigger('click')
          await flushPromises()
        }
        const add = wrapper.findAll('button').find((b) => b.text() === 'Добавить позицию')!
        expect(add.attributes('disabled')).toBeUndefined()
        await add.trigger('click')
        await wrapper
          .findAll('button')
          .find((b) => b.text() === 'Готово')!
          .trigger('click')
        await flushPromises()
        expect(store.activeStrategy).toMatchObject({
          assetCode: asset.asset_code,
          assetType: asset.asset_type,
        })
        expect(store.activeStrategy!.positions).toHaveLength(2)
        expect(store.activeStrategy!.positions[1]).toMatchObject({ secid, type, price: 100 })
        if (type !== 'futures') {
          expect(optionCalcApi.getInstrument).toHaveBeenCalledWith(secid, expect.anything())
          expect(store.activeStrategy!.positions[1]!.expirationDate).toBeUndefined()
        }
      },
    )
  },
)
