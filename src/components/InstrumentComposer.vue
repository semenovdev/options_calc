<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Check, LoaderCircle, Search, X } from '@lucide/vue'

import { getMarketPrice } from '@/api/iss'
import { optionCalcApi } from '@/api/optionCalc'
import { usePortfolioStore } from '@/stores/portfolio'
import type { Asset, Future, InstrumentType, OptionBoardRow, OptionSeries } from '@/types/moex'
import type { Position } from '@/types/portfolio'
import { formatNumber, todayMoscow } from '@/utils/format'
import {
  hasTheoreticalPrice,
  isLiquidOption,
  optionMarketPrice,
  optionSpreadPercent,
  optionsBySpot,
  spotDividerPosition,
} from '@/utils/options'

const FUTURES_SEARCH_ALIASES: Record<string, string[]> = {
  SBER: ['SBRF'],
  СБЕР: ['SBRF'],
}

const props = defineProps<{ useActiveAsset?: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const store = usePortfolioStore()

const step = ref<'asset' | 'instrument'>('asset')
const query = ref('')
const assets = ref<Asset[]>([])
const searchFutures = ref<{ asset: Asset; future: Future }[]>([])
const asset = ref<Asset | null>(null)
const instrumentType = ref<Extract<InstrumentType, 'option' | 'futures' | 'share'>>('option')
const series = ref<OptionSeries[]>([])
const selectedSeriesCode = ref('')
const board = ref<OptionBoardRow[]>([])
const futures = ref<Future[]>([])
const selectedSecid = ref('')
const linkedFutureCode = ref('')
const optionSide = ref<'call' | 'put'>('call')
const optionPriceMode = ref<'theoretical' | 'market'>('market')
const strikeRange = ref(5)
const underlyingPrice = ref<number | null>(null)
const optionListRef = ref<globalThis.HTMLElement | null>(null)
const quantity = ref(1)
const price = ref<number | undefined>()
const instrumentFilter = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const pendingPositions = ref<Omit<Position, 'id'>[]>([])
let searchTimer: ReturnType<typeof globalThis.setTimeout> | undefined
let instrumentRequestId = 0
let searchRequestId = 0
let selectingSearchFuture = false

const selectedSeries = computed(() =>
  series.value.find((item) => item.optionseries_code === selectedSeriesCode.value),
)
function eligibleOptions(side: 'call' | 'put', mode: 'market' | 'theoretical') {
  const options = board.value.filter(
    (item) =>
      item.option_type === side &&
      (mode === 'market'
        ? optionMarketPrice(item, quantity.value) !== null
        : hasTheoreticalPrice(item)),
  )
  return Array.from(new Map(options.map((item) => [item.secid, item])).values())
}

const optionCounts = computed(() => {
  return {
    call: eligibleOptions('call', optionPriceMode.value).length,
    put: eligibleOptions('put', optionPriceMode.value).length,
  }
})
const filteredBoard = computed(() => {
  const needle = instrumentFilter.value.toLowerCase().trim()
  const matching = eligibleOptions(optionSide.value, optionPriceMode.value).filter(
    (item) =>
      !needle || item.secid.toLowerCase().includes(needle) || String(item.strike).includes(needle),
  )
  const range = Number.isFinite(strikeRange.value) ? Math.max(0, strikeRange.value) : 5
  return optionsBySpot(matching, underlyingPrice.value, range).sort(
    (left, right) => right.strike - left.strike,
  )
})
const selectedOption = computed(() =>
  board.value.find((item) => item.secid === selectedSecid.value),
)
const selectedFuture = computed(() =>
  futures.value.find((item) => item.futures_code === selectedSecid.value),
)
const constrainedPositions = computed(() => [
  ...(props.useActiveAsset ? (store.activeStrategy?.positions ?? []) : []),
  ...pendingPositions.value,
])
const lockedSeriesCode = computed(
  () => constrainedPositions.value.find((position) => position.optionSeriesCode)?.optionSeriesCode,
)
const lockedExpirationDate = computed(
  () =>
    constrainedPositions.value.find(
      (position) => position.type === 'option' && position.expirationDate,
    )?.expirationDate,
)
const lockedFutureCode = computed(
  () =>
    constrainedPositions.value.find((position) => position.underlyingFutureCode)
      ?.underlyingFutureCode ??
    constrainedPositions.value.find((position) => position.type === 'futures')?.secid ??
    selectedSeries.value?.futures_code ??
    undefined,
)
const canAdd = computed(() =>
  Boolean(
    asset.value &&
    selectedSecid.value &&
    quantity.value &&
    price.value !== undefined &&
    Number.isFinite(price.value),
  ),
)
const atmStrike = computed(() => {
  if (!filteredBoard.value.length || !underlyingPrice.value) return null
  return filteredBoard.value.reduce((closest, item) =>
    Math.abs(item.strike - underlyingPrice.value!) <
    Math.abs(closest.strike - underlyingPrice.value!)
      ? item
      : closest,
  ).strike
})
const spotDividerIndex = computed(() => {
  return spotDividerPosition(filteredBoard.value, underlyingPrice.value)
})

watch(query, (value) => {
  globalThis.clearTimeout(searchTimer)
  const requestId = ++searchRequestId
  if (value.trim().length < 1) {
    assets.value = []
    searchFutures.value = []
    return
  }
  searchTimer = globalThis.setTimeout(async () => {
    loading.value = true
    error.value = null
    assets.value = []
    searchFutures.value = []
    try {
      const aliases = futuresSearchAliases(value)
      const searchResults = await Promise.allSettled([
        optionCalcApi.searchAssets(value.trim()),
        ...aliases.map((code) => optionCalcApi.searchAssets(code, 'futures')),
      ])
      const foundAssets = Array.from(
        new Map(
          searchResults
            .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
            .map((item) => [`${item.asset_type}:${item.asset_code}`, item]),
        ).values(),
      )
      if (requestId !== searchRequestId) return
      assets.value = foundAssets
      const futuresResults = await Promise.allSettled(
        foundAssets.map(async (foundAsset) => ({
          asset: foundAsset,
          futures: await optionCalcApi.getFutures(foundAsset.asset_code),
        })),
      )
      if (requestId !== searchRequestId) return
      searchFutures.value = futuresResults
        .flatMap((result) =>
          result.status === 'fulfilled'
            ? result.value.futures.map((future) => ({ asset: result.value.asset, future }))
            : [],
        )
        .filter(({ future }) => !future.expiration_date || future.expiration_date >= todayMoscow())
        .sort((left, right) =>
          (left.future.expiration_date ?? '').localeCompare(right.future.expiration_date ?? ''),
        )
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
    underlyingPrice.value = null
    const quoteSecid = currentSeries?.futures_code || asset.value.asset_code
    const quote = await getMarketPrice(quoteSecid)
    if (quote.price === null) {
      throw new Error(`Нет текущей цены базового актива ${quoteSecid}`)
    }
    underlyingPrice.value = quote.price
    await scrollToAtm()
  } catch (reason) {
    board.value = []
    underlyingPrice.value = null
    error.value = reason instanceof Error ? reason.message : 'Не удалось загрузить доску опционов'
  } finally {
    loading.value = false
  }
})

watch(instrumentType, async (type) => {
  if (selectingSearchFuture || !asset.value || step.value !== 'instrument') return
  await loadInstruments(type)
})

watch(strikeRange, () => void scrollToAtm())

watch([optionSide, optionPriceMode], () => {
  selectedSecid.value = ''
  price.value = undefined
  void scrollToAtm()
})

watch(quantity, () => {
  if (instrumentType.value !== 'option' || optionPriceMode.value !== 'market') return
  const option = selectedOption.value
  price.value = option ? (optionMarketPrice(option, quantity.value) ?? undefined) : undefined
})

watch(open, async (isOpen) => {
  if (!isOpen) return
  reset()
  const strategy = store.activeStrategy
  if (!props.useActiveAsset || !strategy?.positions.length) return

  await chooseAsset({
    asset_code: strategy.assetCode,
    asset_type: strategy.assetType,
    title: strategy.positions[0]?.title || strategy.assetCode,
  })
})

function reset(): void {
  step.value = 'asset'
  query.value = ''
  assets.value = []
  searchFutures.value = []
  asset.value = null
  instrumentType.value = 'option'
  series.value = []
  selectedSeriesCode.value = ''
  board.value = []
  futures.value = []
  selectedSecid.value = ''
  linkedFutureCode.value = ''
  optionSide.value = 'call'
  optionPriceMode.value = 'market'
  strikeRange.value = 5
  underlyingPrice.value = null
  quantity.value = 1
  price.value = undefined
  error.value = null
  pendingPositions.value = []
}

function close(): void {
  open.value = false
  reset()
}

async function chooseAsset(value: Asset): Promise<void> {
  asset.value = value
  linkedFutureCode.value = ''
  step.value = 'instrument'
  instrumentType.value = 'option'
  await loadInstruments(instrumentType.value)
}

async function chooseSearchFuture(result: { asset: Asset; future: Future }): Promise<void> {
  selectingSearchFuture = true
  try {
    asset.value = result.asset
    instrumentType.value = 'futures'
    futures.value = searchFutures.value
      .filter(({ asset: foundAsset }) => foundAsset.asset_code === result.asset.asset_code)
      .map(({ future }) => future)
    step.value = 'instrument'
    await chooseSecid(result.future.futures_code)
    await nextTick()
  } finally {
    selectingSearchFuture = false
  }
}

async function loadInstruments(type: typeof instrumentType.value): Promise<void> {
  if (!asset.value) return
  const requestId = ++instrumentRequestId
  loading.value = true
  error.value = null
  selectedSecid.value = ''
  price.value = undefined
  try {
    if (type === 'option') {
      const result = await optionCalcApi.getSeries(asset.value.asset_code, asset.value.asset_type)
      if (requestId !== instrumentRequestId) return
      const activeSeries = result.filter(
        (item) =>
          item.expiration_date >= todayMoscow() &&
          (!lockedSeriesCode.value || item.optionseries_code === lockedSeriesCode.value) &&
          (!lockedExpirationDate.value || item.expiration_date === lockedExpirationDate.value) &&
          (!lockedFutureCode.value || item.futures_code === lockedFutureCode.value),
      )
      series.value = linkedFutureCode.value
        ? activeSeries.filter((item) => item.futures_code === linkedFutureCode.value)
        : activeSeries
      series.value.sort((a, b) => a.expiration_date.localeCompare(b.expiration_date))
      selectedSeriesCode.value = series.value[0]?.optionseries_code ?? ''
      if (linkedFutureCode.value && !series.value.length) {
        error.value = `Для ${linkedFutureCode.value} нет активных опционных серий`
      }
    } else if (type === 'futures') {
      const result = await optionCalcApi.getFutures(asset.value.asset_code)
      if (requestId !== instrumentRequestId) return
      futures.value = lockedFutureCode.value
        ? result.filter((item) => item.futures_code === lockedFutureCode.value)
        : result
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
    price.value = option ? (selectedOptionPrice(option) ?? undefined) : undefined
  } else {
    const future = futures.value.find((item) => item.futures_code === secid)
    linkedFutureCode.value = secid
    const quote = await getMarketPrice(future?.futures_code ?? secid)
    if (quote.price === null) throw new Error(`Нет текущей цены инструмента ${secid}`)
    price.value = quote.price
  }
}

function futuresSearchAliases(value: string): string[] {
  const normalized = value.trim().toUpperCase().replace(/Ё/g, 'Е')
  return Array.from(
    new Set(
      Object.entries(FUTURES_SEARCH_ALIASES).flatMap(([needle, aliases]) =>
        normalized.includes(needle) ? aliases : [],
      ),
    ),
  )
}

function selectedOptionPrice(option: OptionBoardRow): number | null {
  return optionPriceMode.value === 'market'
    ? optionMarketPrice(option, quantity.value)
    : (option.theorprice ?? null)
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
  const option = selectedOption.value
  const future = selectedFuture.value
  const expirationDate =
    option?.expiration_date ?? selectedSeries.value?.expiration_date ?? future?.expiration_date
  if (
    instrumentType.value === 'option' &&
    lockedExpirationDate.value &&
    expirationDate !== lockedExpirationDate.value
  ) {
    error.value = `В стратегии уже выбрана экспирация ${lockedExpirationDate.value}`
    return
  }
  if (
    lockedFutureCode.value &&
    instrumentType.value === 'futures' &&
    selectedSecid.value !== lockedFutureCode.value
  ) {
    error.value = `В стратегии уже выбран фьючерс ${lockedFutureCode.value}`
    return
  }
  pendingPositions.value.push({
    secid: selectedSecid.value,
    type: instrumentType.value,
    quantity: quantity.value,
    price: price.value,
    nettedIm: true,
    expirationDate,
    optionSeriesCode: option ? selectedSeries.value?.optionseries_code : undefined,
    underlyingFutureCode: option
      ? (selectedSeries.value?.futures_code ?? undefined)
      : future?.futures_code,
    strike: option?.strike,
    optionType: option?.option_type,
    title: asset.value.title,
  })
  selectedSecid.value = instrumentType.value === 'share' ? asset.value.asset_code : ''
  price.value = undefined
}

function finish(): void {
  if (!asset.value || !pendingPositions.value.length) return
  const strategy = store.activeStrategy
  if (strategy && strategy.positions.length && strategy.assetCode !== asset.value.asset_code) {
    error.value = 'В одной стратегии можно использовать только один базовый актив'
    return
  }
  if (!strategy) return
  strategy.assetCode = asset.value.asset_code
  strategy.assetType = asset.value.asset_type
  strategy.marketPrice = null

  pendingPositions.value.forEach((position) => store.addPosition(position))
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
              <div v-if="searchFutures.length" class="search-result-group">Фьючерсы</div>
              <button
                v-for="result in searchFutures"
                :key="`${result.asset.asset_code}:${result.future.futures_code}`"
                @click="chooseSearchFuture(result)"
              >
                <span class="result-code">{{ result.future.futures_code }}</span>
                <span
                  ><strong>{{ result.future.shortname || result.asset.title }}</strong
                  ><small
                    >Фьючерс · экспирация {{ result.future.expiration_date ?? 'не указана' }}</small
                  ></span
                >
              </button>
              <div v-if="assets.length" class="search-result-group">Базовые активы</div>
              <button v-for="item in assets" :key="item.asset_code" @click="chooseAsset(item)">
                <span class="result-code">{{ item.asset_code }}</span>
                <span
                  ><strong>{{ item.title }}</strong
                  ><small>{{ item.asset_type }}</small></span
                >
              </button>
              <div
                v-if="query && !loading && !assets.length && !searchFutures.length && !error"
                class="empty-search"
              >
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
                <select
                  v-model="selectedSeriesCode"
                  :disabled="Boolean(lockedSeriesCode || lockedExpirationDate)"
                >
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
                  Call <span>{{ optionCounts.call }}</span>
                </button>
                <button :class="{ active: optionSide === 'put' }" @click="optionSide = 'put'">
                  Put <span>{{ optionCounts.put }}</span>
                </button>
              </div>
              <div class="option-price-control" aria-label="Источник цены опциона">
                <button
                  :class="{ active: optionPriceMode === 'market' }"
                  @click="optionPriceMode = 'market'"
                >
                  Рыночная
                </button>
                <button
                  :class="{ active: optionPriceMode === 'theoretical' }"
                  @click="optionPriceMode = 'theoretical'"
                >
                  Расчётная
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
                <template v-for="(item, index) in filteredBoard" :key="item.secid">
                  <div v-if="index === spotDividerIndex" class="spot-divider">
                    <span>Spot {{ formatNumber(underlyingPrice) }}</span>
                  </div>
                  <button
                    :class="{ selected: selectedSecid === item.secid }"
                    :data-atm="item.strike === atmStrike"
                    @click="chooseSecid(item.secid)"
                  >
                    <span class="strike-primary">
                      <strong>{{ formatNumber(item.strike) }}</strong>
                      <small>{{ item.secid }}</small>
                    </span>
                    <span
                      class="liquidity-mark"
                      :class="{ theoretical: optionPriceMode === 'theoretical' }"
                    >
                      <i></i>
                      <small>{{
                        optionPriceMode === 'market' ? liquidityText(item) : 'Расчёт MOEX'
                      }}</small>
                    </span>
                    <span class="quote" :class="{ comparison: optionPriceMode === 'market' }">
                      <span v-if="optionPriceMode === 'market'" class="quote-value">
                        <small>Рынок</small>
                        <strong>{{ formatNumber(optionMarketPrice(item, quantity)) }}</strong>
                      </span>
                      <span class="quote-value">
                        <small>Расчёт</small>
                        <strong>{{ formatNumber(item.theorprice) }}</strong>
                      </span>
                      <small class="quote-iv">IV {{ formatNumber(item.volatility) }}%</small>
                    </span>
                    <Check v-if="selectedSecid === item.secid" :size="16" />
                  </button>
                </template>
                <div v-if="spotDividerIndex === filteredBoard.length" class="spot-divider">
                  <span>Spot {{ formatNumber(underlyingPrice) }}</span>
                </div>
                <div v-if="!loading && !filteredBoard.length" class="empty-options">
                  <span>
                    Нет {{ optionSide.toUpperCase() }}
                    {{
                      optionPriceMode === 'market'
                        ? 'с ликвидной рыночной котировкой'
                        : 'с расчётной ценой'
                    }}
                    в выбранном диапазоне
                  </span>
                </div>
              </div>
            </div>

            <div v-else-if="instrumentType === 'futures'" class="future-picker">
              <div class="option-list futures-list">
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
              <button
                v-if="linkedFutureCode"
                class="secondary-button full related-options-button"
                @click="instrumentType = 'option'"
              >
                Выбрать опционы на {{ linkedFutureCode }}
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
                  :placeholder="
                    instrumentType === 'option' && optionPriceMode === 'theoretical'
                      ? 'Расчётная'
                      : 'Рыночная'
                  "
              /></label>
            </div>
          </div>

          <div v-if="error" class="dialog-error">{{ error }}</div>
          <footer v-if="step === 'instrument'" class="dialog-footer">
            <span v-if="pendingPositions.length" class="pending-count">
              В наборе: {{ pendingPositions.length }}
            </span>
            <button v-if="!props.useActiveAsset" class="secondary-button" @click="step = 'asset'">
              Назад
            </button>
            <button class="primary-button" :disabled="!canAdd || loading" @click="add">
              Добавить позицию
            </button>
            <button
              class="secondary-button done-button"
              :disabled="!pendingPositions.length || loading"
              @click="finish"
            >
              Готово
            </button>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
