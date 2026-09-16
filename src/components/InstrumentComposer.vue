<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Check, LoaderCircle, Search, X } from '@lucide/vue'

import { getMarketPrice } from '@/api/iss'
import { optionCalcApi } from '@/api/optionCalc'
import { usePortfolioStore } from '@/stores/portfolio'
import type { Asset, Future, InstrumentType, OptionBoardRow, OptionSeries } from '@/types/moex'
import { formatNumber, todayMoscow } from '@/utils/format'
import {
  isLiquidOption,
  optionMarketPrice,
  optionSpreadPercent,
  optionsAroundPrice,
} from '@/utils/options'

const open = defineModel<boolean>('open', { required: true })
const store = usePortfolioStore()

const step = ref<'asset' | 'instrument'>('asset')
const query = ref('')
const assets = ref<Asset[]>([])
const asset = ref<Asset | null>(null)
const instrumentType = ref<Extract<InstrumentType, 'option' | 'futures' | 'share'>>('option')
const series = ref<OptionSeries[]>([])
const selectedSeriesCode = ref('')
const board = ref<OptionBoardRow[]>([])
const futures = ref<Future[]>([])
const selectedSecid = ref('')
const optionSide = ref<'call' | 'put'>('call')
const strikeRange = ref(5)
const underlyingPrice = ref<number | null>(null)
const optionListRef = ref<globalThis.HTMLElement | null>(null)
const quantity = ref(1)
const price = ref<number | undefined>()
const volatility = ref<number | undefined>()
const instrumentFilter = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
let searchTimer: ReturnType<typeof globalThis.setTimeout> | undefined
let instrumentRequestId = 0

const selectedSeries = computed(() =>
  series.value.find((item) => item.optionseries_code === selectedSeriesCode.value),
)
const filteredBoard = computed(() => {
  const needle = instrumentFilter.value.toLowerCase().trim()
  const sideOptions = board.value.filter(
    (item) =>
      item.option_type === optionSide.value &&
      (!needle ||
        item.secid.toLowerCase().includes(needle) ||
        String(item.strike).includes(needle)),
  )
  const liquidOptions = sideOptions.filter(isLiquidOption)
  const matching = liquidOptions.length
    ? liquidOptions
    : sideOptions.filter((item) => (item.theorprice ?? 0) > 0)
  return needle
    ? matching.slice(0, 40)
    : optionsAroundPrice(
        matching,
        underlyingPrice.value,
        Math.max(0, strikeRange.value),
        Math.max(0, strikeRange.value),
      )
})
const showingTheoreticalFallback = computed(() =>
  filteredBoard.value.some((option) => !isLiquidOption(option)),
)
const selectedOption = computed(() =>
  board.value.find((item) => item.secid === selectedSecid.value),
)
const selectedFuture = computed(() =>
  futures.value.find((item) => item.futures_code === selectedSecid.value),
)
const canAdd = computed(() => Boolean(asset.value && selectedSecid.value && quantity.value))
const atmStrike = computed(() => {
  if (!filteredBoard.value.length || !underlyingPrice.value) return null
  return filteredBoard.value.reduce((closest, item) =>
    Math.abs(item.strike - underlyingPrice.value!) <
    Math.abs(closest.strike - underlyingPrice.value!)
      ? item
      : closest,
  ).strike
})

watch(query, (value) => {
  globalThis.clearTimeout(searchTimer)
  if (value.trim().length < 1) {
    assets.value = []
    return
  }
  searchTimer = globalThis.setTimeout(async () => {
    loading.value = true
    error.value = null
    assets.value = []
    try {
      assets.value = await optionCalcApi.searchAssets(value.trim())
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : 'Ошибка поиска'
    } finally {
      loading.value = false
    }
  }, 250)
})

watch(selectedSeriesCode, async (code) => {
  if (!asset.value || !code || instrumentType.value !== 'option') return
  const requestId = instrumentRequestId
  loading.value = true
  error.value = null
  try {
    board.value = await optionCalcApi.getOptionBoard(
      asset.value.asset_code,
      code,
      asset.value.asset_type,
    )
    if (requestId !== instrumentRequestId || instrumentType.value !== 'option') return
    selectedSecid.value = ''
    const currentSeries = series.value.find((item) => item.optionseries_code === code)
    underlyingPrice.value = currentSeries?.central_strike ?? null
    const quoteSecid = currentSeries?.futures_code || asset.value.asset_code
    try {
      underlyingPrice.value = (await getMarketPrice(quoteSecid)).price ?? underlyingPrice.value
    } catch {
      // The central strike remains a useful ATM fallback when ISS has no quote.
    }
    await scrollToAtm()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : 'Не удалось загрузить доску опционов'
  } finally {
    loading.value = false
  }
})

watch(instrumentType, async (type) => {
  if (!asset.value || step.value !== 'instrument') return
  await loadInstruments(type)
})

watch([optionSide, strikeRange], () => void scrollToAtm())

function reset(): void {
  step.value = 'asset'
  query.value = ''
  assets.value = []
  asset.value = null
  instrumentType.value = 'option'
  series.value = []
  selectedSeriesCode.value = ''
  board.value = []
  futures.value = []
  selectedSecid.value = ''
  optionSide.value = 'call'
  strikeRange.value = 5
  underlyingPrice.value = null
  quantity.value = 1
  price.value = undefined
  volatility.value = undefined
  error.value = null
}

function close(): void {
  open.value = false
  reset()
}

async function chooseAsset(value: Asset): Promise<void> {
  asset.value = value
  step.value = 'instrument'
  if (value.asset_type === 'share') instrumentType.value = 'option'
  await loadInstruments(instrumentType.value)
}

async function loadInstruments(type: typeof instrumentType.value): Promise<void> {
  if (!asset.value) return
  const requestId = ++instrumentRequestId
  loading.value = true
  error.value = null
  selectedSecid.value = ''
  try {
    if (type === 'option') {
      const result = await optionCalcApi.getSeries(asset.value.asset_code, asset.value.asset_type)
      if (requestId !== instrumentRequestId) return
      series.value = result
      series.value.sort((a, b) => a.expiration_date.localeCompare(b.expiration_date))
      const today = todayMoscow()
      selectedSeriesCode.value =
        series.value.find((item) => item.expiration_date >= today)?.optionseries_code ??
        series.value[0]?.optionseries_code ??
        ''
    } else if (type === 'futures') {
      const result = await optionCalcApi.getFutures(asset.value.asset_code)
      if (requestId !== instrumentRequestId) return
      futures.value = result
    } else {
      selectedSecid.value = asset.value.asset_code
      const quote = await getMarketPrice(asset.value.asset_code)
      if (requestId !== instrumentRequestId) return
      price.value = quote.price ?? undefined
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : 'Не удалось загрузить инструменты'
  } finally {
    loading.value = false
  }
}

async function chooseSecid(secid: string): Promise<void> {
  selectedSecid.value = secid
  if (instrumentType.value === 'option') {
    const option = board.value.find((item) => item.secid === secid)
    price.value = option ? (optionMarketPrice(option) ?? undefined) : undefined
    volatility.value = option?.volatility ?? undefined
  } else {
    const future = futures.value.find((item) => item.futures_code === secid)
    price.value = future?.last ?? future?.settleprice ?? undefined
    if (price.value === undefined) {
      const quote = await getMarketPrice(secid)
      price.value = quote.price ?? undefined
    }
  }
}

async function scrollToAtm(): Promise<void> {
  await nextTick()
  optionListRef.value
    ?.querySelector<globalThis.HTMLElement>('[data-atm="true"]')
    ?.scrollIntoView({ block: 'center' })
}

function liquidityText(option: OptionBoardRow): string {
  if (!isLiquidOption(option)) return 'Только расчётная цена'
  const spread = optionSpreadPercent(option)
  return spread === null ? 'Нет котировок' : `Спред ${formatNumber(spread)}%`
}

function add(): void {
  if (!asset.value || !canAdd.value) return
  let strategy = store.activeStrategy
  if (strategy && strategy.positions.length && strategy.assetCode !== asset.value.asset_code) {
    store.addStrategy()
    strategy = store.activeStrategy
  }
  if (!strategy) return
  strategy.assetCode = asset.value.asset_code
  strategy.assetType = asset.value.asset_type
  strategy.marketPrice = null

  const option = selectedOption.value
  const future = selectedFuture.value
  store.addPosition({
    secid: selectedSecid.value,
    type: instrumentType.value,
    quantity: quantity.value,
    price: price.value,
    volatility: volatility.value,
    nettedIm: true,
    expirationDate:
      option?.expiration_date ?? selectedSeries.value?.expiration_date ?? future?.expiration_date,
    strike: option?.strike,
    optionType: option?.option_type,
    title: asset.value.title,
  })
  close()
  void store.calculate()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" @mousedown.self="close">
        <section
          class="composer-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Добавить инструмент"
        >
          <header class="dialog-header">
            <div>
              <span class="eyebrow">НОВАЯ ПОЗИЦИЯ</span>
              <h2>{{ step === 'asset' ? 'Выберите базовый актив' : asset?.title }}</h2>
            </div>
            <button class="icon-button" title="Закрыть" @click="close"><X :size="18" /></button>
          </header>

          <div v-if="step === 'asset'" class="dialog-body">
            <label class="search-field large">
              <Search :size="18" />
              <input
                v-model="query"
                autofocus
                placeholder="Тикер или название, например SBER или Si"
              />
              <LoaderCircle v-if="loading" class="spinning" :size="17" />
            </label>
            <div class="asset-results">
              <button v-for="item in assets" :key="item.asset_code" @click="chooseAsset(item)">
                <span class="result-code">{{ item.asset_code }}</span>
                <span
                  ><strong>{{ item.title }}</strong
                  ><small>{{ item.asset_type }}</small></span
                >
              </button>
              <div v-if="query && !loading && !assets.length && !error" class="empty-search">
                Ничего не найдено
              </div>
            </div>
          </div>

          <div v-else class="dialog-body instrument-step">
            <div class="segmented-control">
              <button
                :class="{ active: instrumentType === 'option' }"
                @click="instrumentType = 'option'"
              >
                Опцион
              </button>
              <button
                :class="{ active: instrumentType === 'futures' }"
                @click="instrumentType = 'futures'"
              >
                Фьючерс
              </button>
              <button
                :class="{ active: instrumentType === 'share' }"
                :disabled="asset?.asset_type !== 'share'"
                @click="instrumentType = 'share'"
              >
                Акция
              </button>
            </div>

            <div v-if="instrumentType === 'option'" class="instrument-picker">
              <label class="field-label"
                >Экспирация
                <select v-model="selectedSeriesCode">
                  <option
                    v-for="item in series"
                    :key="item.optionseries_code"
                    :value="item.optionseries_code"
                  >
                    {{ item.expiration_date }} · {{ item.optionseries_code }}
                  </option>
                </select>
              </label>
              <div class="option-side-control" aria-label="Тип опциона">
                <button :class="{ active: optionSide === 'call' }" @click="optionSide = 'call'">
                  Call
                </button>
                <button :class="{ active: optionSide === 'put' }" @click="optionSide = 'put'">
                  Put
                </button>
              </div>
              <div class="strike-window-controls">
                <span class="spot-indicator">
                  Базовый актив <strong>{{ formatNumber(underlyingPrice) }}</strong>
                </span>
                <label
                  >Страйков в каждую сторону<input
                    v-model.number="strikeRange"
                    type="number"
                    min="0"
                    max="30"
                /></label>
              </div>
              <label class="search-field compact"
                ><Search :size="15" /><input
                  v-model="instrumentFilter"
                  placeholder="Страйк или SECID"
              /></label>
              <div ref="optionListRef" class="option-list strike-list">
                <div v-if="showingTheoreticalFallback" class="fallback-notice">
                  Нет ликвидных котировок — показаны страйки с расчётной ценой MOEX
                </div>
                <button
                  v-for="item in filteredBoard"
                  :key="item.secid"
                  :class="{ selected: selectedSecid === item.secid }"
                  :data-atm="item.strike === atmStrike"
                  @click="chooseSecid(item.secid)"
                >
                  <span class="strike-primary">
                    <strong>{{ formatNumber(item.strike) }}</strong>
                    <small>{{ item.secid }}</small>
                  </span>
                  <span class="liquidity-mark" :class="{ theoretical: !isLiquidOption(item) }">
                    <i></i><small>{{ liquidityText(item) }}</small>
                  </span>
                  <span class="quote">
                    <strong>{{ formatNumber(optionMarketPrice(item)) }}</strong>
                    <small
                      >Расч. {{ formatNumber(item.theorprice) }} · IV
                      {{ formatNumber(item.volatility) }}%</small
                    >
                  </span>
                  <Check v-if="selectedSecid === item.secid" :size="16" />
                </button>
                <div v-if="!loading && !filteredBoard.length" class="empty-options">
                  Нет {{ optionSide.toUpperCase() }} с расчётной ценой в выбранном диапазоне
                </div>
              </div>
            </div>

            <div v-else-if="instrumentType === 'futures'" class="option-list futures-list">
              <button
                v-for="item in futures"
                :key="item.futures_code"
                :class="{ selected: selectedSecid === item.futures_code }"
                @click="chooseSecid(item.futures_code)"
              >
                <span class="future-contract">
                  <strong>{{ item.futures_code }}</strong>
                  <small>Экспирация {{ item.expiration_date ?? 'не указана' }}</small>
                </span>
                <span v-if="selectedSecid === item.futures_code" class="future-selected">
                  Выбран · {{ formatNumber(price) }}
                </span>
                <Check v-if="selectedSecid === item.futures_code" :size="16" />
              </button>
            </div>

            <div v-else class="selected-share">
              <Check :size="18" /> {{ asset?.asset_code }} · {{ asset?.title }}
            </div>

            <div class="order-fields">
              <label class="field-label"
                >Количество<input v-model.number="quantity" type="number" step="1"
              /></label>
              <label class="field-label"
                >Цена входа<input
                  v-model.number="price"
                  type="number"
                  step="any"
                  placeholder="Рыночная"
              /></label>
              <label class="field-label"
                >Волатильность, %<input
                  v-model.number="volatility"
                  type="number"
                  step="0.1"
                  :disabled="instrumentType !== 'option'"
              /></label>
            </div>
          </div>

          <div v-if="error" class="dialog-error">{{ error }}</div>
          <footer v-if="step === 'instrument'" class="dialog-footer">
            <button class="secondary-button" @click="step = 'asset'">Назад</button>
            <button class="primary-button" :disabled="!canAdd || loading" @click="add">
              Добавить позицию
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
