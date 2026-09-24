<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { EChartsOption } from 'echarts'
import { BarChart3, Droplets, LineChart as LineChartIcon, LoaderCircle } from '@lucide/vue'

import { isAbortError } from '@/api/http'
import { optionCalcApi } from '@/api/optionCalc'
import { usePortfolioStore } from '@/stores/portfolio'
import type {
  IndicatorPoint,
  IndicatorType,
  OptionBoardRow,
  OptionSeries,
  VolatilityPoint,
} from '@/types/moex'
import {
  formatCompact,
  formatMoneyFixed,
  formatNumber,
  formatPercent,
  todayMoscow,
} from '@/utils/format'
import {
  isLiquidOption,
  niceAxisStep,
  optionSpreadPercent,
  profitLossIntervals,
} from '@/utils/options'

type WorkspaceTab = 'profile' | 'smile' | 'liquidity'
const store = usePortfolioStore()
const activeTab = ref<WorkspaceTab>('profile')
const indicator = computed({
  get: () => store.selectedIndicator,
  set: (value: IndicatorType) => {
    store.selectedIndicator = value
  },
})
const scenarioVisible = ref(false)
const series = ref<OptionSeries[]>([])
const selectedSeriesCode = ref('')
const board = ref<OptionBoardRow[]>([])
const smile = ref<VolatilityPoint[]>([])
const smileMode = ref<string | null>(null)
const smileSource = computed(() =>
  smileMode.value === 'market'
    ? 'Улыбка — рынок'
    : smileMode.value === 'settlement'
      ? 'Улыбка — расчётные цены'
      : 'Улыбка — источник не указан',
)
const loadingMarket = ref(false)
const marketError = ref<string | null>(null)
let seriesController: globalThis.AbortController | undefined
let dataController: globalThis.AbortController | undefined
let seriesLoaded = false

const indicatorLabels: Record<IndicatorType, string> = {
  profit_and_loss: 'P&L',
  delta: 'Delta',
  gamma: 'Gamma',
  vega: 'Vega',
  theta: 'Theta',
  rho: 'Rho',
}

const selectedSeries = computed(() =>
  series.value.find((item) => item.optionseries_code === selectedSeriesCode.value),
)
const currentGraph = computed(() => store.calculation.graphs[indicator.value])
const liquidBoard = computed(() => board.value.filter((option) => isLiquidOption(option)))
const chartBounds = computed(() => {
  const positionStrikes =
    store.activeStrategy?.positions
      .map((position) => position.strike)
      .filter((strike): strike is number => Boolean(strike)) ?? []
  const spot = store.activeStrategy?.marketPrice
  if (spot && spot > 0) {
    const minimum = Math.max(
      0,
      Math.min(spot * 0.75, ...positionStrikes.map((strike) => strike * 0.95)),
    )
    const maximum = Math.max(spot * 1.25, ...positionStrikes.map((strike) => strike * 1.05))
    return { minimum, maximum, spot, step: niceAxisStep(maximum - minimum) }
  }
  return { minimum: 0, maximum: 100, spot: null, step: 20 }
})

const baseChartStyle: EChartsOption = {
  backgroundColor: 'transparent',
  animationDuration: 350,
  textStyle: { fontFamily: 'Inter, Arial, sans-serif', color: '#9ba5b4' },
  grid: {
    left: 14,
    right: 24,
    top: 36,
    bottom: 28,
    outerBoundsMode: 'same',
    outerBoundsContain: 'axisLabel',
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'cross', lineStyle: { color: '#748195', type: 'dashed' } },
    backgroundColor: '#171c24',
    borderColor: '#343d49',
    textStyle: { color: '#f2f5f8' },
  },
  legend: { right: 16, top: 4, textStyle: { color: '#9ba5b4' } },
  xAxis: {
    type: 'value',
    name: 'Цена базового актива',
    nameLocation: 'middle',
    nameGap: 25,
    axisLine: { lineStyle: { color: '#343d49' } },
    splitLine: { lineStyle: { color: '#202630' } },
  },
  yAxis: {
    type: 'value',
    axisLine: { show: false },
    splitLine: { lineStyle: { color: '#202630' } },
  },
}

const profileOption = computed<EChartsOption>(() => {
  const graph = currentGraph.value
  const bounds = chartBounds.value
  const chartData = (points: IndicatorPoint[]) =>
    points.map((point) => [point.underlying_price, point.value])
  const nowPoints = graph?.now ?? []
  const expirationSource = graph?.on_expiration ?? []
  const expirationPoints = expirationSource
  const scenarioPoints = graph?.on_what_if ?? []
  const payoffZones = profitLossIntervals(expirationPoints)
  const graphValues = [...nowPoints, ...expirationPoints, ...scenarioPoints].map(
    (point) => point.value,
  )
  const graphMinimum = Math.min(0, ...graphValues)
  const graphMaximum = Math.max(0, ...graphValues)
  const yStep = niceAxisStep(graphMaximum - graphMinimum)
  const yMinimum = Math.floor(graphMinimum / yStep) * yStep
  const yMaximum = Math.ceil(graphMaximum / yStep) * yStep
  const tooltipValueFormatter = (value: unknown): string => {
    const rawValue = Array.isArray(value) ? value[value.length - 1] : value
    const numericValue = Number(rawValue)
    return indicator.value === 'profit_and_loss'
      ? formatMoneyFixed(numericValue)
      : formatNumber(numericValue)
  }
  const currentLossSegment: [number, number | null][] = []
  nowPoints.forEach((point, index) => {
    const previous = nowPoints[index - 1]
    if (previous && previous.value * point.value < 0) {
      const ratio = -previous.value / (point.value - previous.value)
      currentLossSegment.push([
        previous.underlying_price + ratio * (point.underlying_price - previous.underlying_price),
        0,
      ])
    }
    currentLossSegment.push([point.underlying_price, point.value <= 0 ? point.value : null])
  })
  const markLine = bounds.spot
    ? {
        silent: true,
        symbol: 'none',
        lineStyle: { color: '#f0b44d', type: 'dashed' as const, width: 1.5 },
        label: {
          show: true,
          formatter: `Базовый ${formatNumber(bounds.spot)}`,
          color: '#f0b44d',
          backgroundColor: '#171c24',
          padding: [4, 6],
          borderRadius: 3,
        },
        data: [{ xAxis: bounds.spot, name: 'Базовый актив' }],
      }
    : undefined
  return {
    ...baseChartStyle,
    xAxis: {
      ...(baseChartStyle.xAxis as object),
      min: bounds.minimum,
      max: bounds.maximum,
      interval: bounds.step,
      splitNumber: 6,
      axisLabel: { hideOverlap: true, formatter: (value: number) => formatNumber(value) },
    },
    legend: {
      ...(baseChartStyle.legend as object),
      data: scenarioPoints.length
        ? ['Сейчас', 'На экспирацию', 'Сценарий']
        : ['Сейчас', 'На экспирацию'],
      selected: { Сценарий: scenarioVisible.value },
    },
    yAxis: {
      ...(baseChartStyle.yAxis as object),
      scale: true,
      splitNumber: 6,
      min: yMinimum,
      max: yMaximum,
    },
    series: [
      ...(indicator.value === 'profit_and_loss'
        ? payoffZones.flatMap((zone, index) =>
            [yMaximum, yMinimum].map((boundary) => ({
              name: `Зона ${zone.profit ? 'прибыли' : 'убытка'} ${index + 1}`,
              type: 'line' as const,
              data: [
                [zone.start, boundary],
                [zone.end, boundary],
              ],
              showSymbol: false,
              silent: true,
              tooltip: { show: false },
              lineStyle: { opacity: 0 },
              areaStyle: {
                color: zone.profit ? 'rgba(69,210,164,.1)' : 'rgba(255,100,116,.1)',
                origin: 0,
              },
              z: 0,
            })),
          )
        : []),
      {
        name: 'Сейчас',
        type: 'line',
        showSymbol: false,
        smooth: 0.16,
        data: chartData(nowPoints),
        lineStyle: { width: 2, color: '#45d2a4' },
        itemStyle: { color: '#45d2a4' },
        tooltip: { valueFormatter: tooltipValueFormatter },
        z: 2,
      },
      ...(indicator.value === 'profit_and_loss'
        ? [
            {
              name: 'Сейчас',
              type: 'line' as const,
              data: currentLossSegment,
              showSymbol: false,
              connectNulls: false,
              silent: true,
              tooltip: { show: false },
              lineStyle: { width: 2.4, color: '#ff6474' },
              z: 4,
            },
          ]
        : []),
      {
        name: 'На экспирацию',
        type: 'line',
        showSymbol: false,
        data: chartData(expirationPoints),
        lineStyle: { width: 2, color: '#5f8ff7' },
        itemStyle: { color: '#5f8ff7' },
        tooltip: { valueFormatter: tooltipValueFormatter },
        z: 2,
      },
      ...(scenarioPoints.length
        ? [
            {
              name: 'Сценарий',
              type: 'line' as const,
              showSymbol: false,
              data: chartData(scenarioPoints),
              lineStyle: { width: 2, color: '#d592ff', type: 'dashed' as const },
              itemStyle: { color: '#d592ff' },
              tooltip: { valueFormatter: tooltipValueFormatter },
            },
          ]
        : []),
      ...(markLine
        ? [
            {
              name: 'Базовый актив',
              type: 'line' as const,
              data: [
                [bounds.minimum, 0],
                [bounds.maximum, 0],
              ],
              showSymbol: false,
              silent: true,
              tooltip: { show: false },
              lineStyle: { opacity: 0 },
              markLine,
              z: 3,
            },
          ]
        : []),
    ],
  }
})

const smileOption = computed<EChartsOption>(() => ({
  ...baseChartStyle,
  xAxis: { ...(baseChartStyle.xAxis as object), name: 'Страйк' },
  yAxis: { ...(baseChartStyle.yAxis as object), name: 'IV, %' },
  legend: { show: false },
  series: [
    {
      name: 'Волатильность',
      type: 'line',
      smooth: 0.25,
      symbolSize: 7,
      data: smile.value.map((point) => [point.strike, point.volatility]),
      lineStyle: { width: 2.5, color: '#d592ff' },
      itemStyle: { color: '#d592ff', borderColor: '#0f1319', borderWidth: 2 },
    },
  ],
}))

function liquidityClass(row: OptionBoardRow): string {
  const value = optionSpreadPercent(row)
  if (!row.bid || !row.offer || !row.numtrades) return 'poor'
  if (value !== null && value > 10) return 'medium'
  return 'good'
}

async function loadMarketData(): Promise<void> {
  const strategy = store.activeStrategy
  if (!strategy || activeTab.value === 'profile') return
  seriesController?.abort()
  const controller = new globalThis.AbortController()
  seriesController = controller
  loadingMarket.value = true
  marketError.value = null
  try {
    const result = await optionCalcApi.getSeries(strategy.assetCode, strategy.assetType, {
      signal: controller.signal,
    })
    if (controller.signal.aborted || seriesController !== controller) return
    series.value = result.filter((item) => item.expiration_date >= todayMoscow())
    series.value.sort((a, b) => a.expiration_date.localeCompare(b.expiration_date))
    const position = strategy.positions.find(
      (position) => position.type === 'option' && position.expirationDate,
    )
    const preferredSeries =
      series.value.find((item) => item.optionseries_code === position?.optionSeriesCode) ??
      series.value.find(
        (item) =>
          item.expiration_date === position?.expirationDate &&
          (!position.underlyingFutureCode || item.futures_code === position.underlyingFutureCode),
      ) ??
      series.value[0]
    seriesLoaded = true
    selectedSeriesCode.value = preferredSeries?.optionseries_code ?? ''
  } catch (reason) {
    if (controller.signal.aborted || seriesController !== controller || isAbortError(reason)) return
    marketError.value = reason instanceof Error ? reason.message : 'Ошибка загрузки рыночных данных'
  } finally {
    if (seriesController === controller && !controller.signal.aborted) {
      seriesController = undefined
      loadingMarket.value = false
    }
  }
}

async function loadSeriesData(): Promise<void> {
  const strategy = store.activeStrategy
  dataController?.abort()
  dataController = undefined
  const tab = activeTab.value
  const seriesCode = selectedSeriesCode.value
  if (!strategy || !seriesCode || tab === 'profile') return
  const controller = new globalThis.AbortController()
  dataController = controller
  loadingMarket.value = true
  marketError.value = null
  board.value = []
  smile.value = []
  smileMode.value = null
  try {
    const options = { signal: controller.signal }
    if (tab === 'smile') {
      const result = await optionCalcApi.getVolatilityGraph(
        strategy.assetCode,
        seriesCode,
        strategy.assetType,
        {
          ...options,
          onValuationMode: (mode) => {
            if (!controller.signal.aborted && dataController === controller) smileMode.value = mode
          },
        },
      )
      if (controller.signal.aborted || dataController !== controller) return
      if (!result.length) throw new Error('backend returned an empty graph')
      const invalidIndex = result.findIndex(
        (point) => !Number.isFinite(point.strike) || !Number.isFinite(point.volatility),
      )
      if (invalidIndex >= 0)
        throw new Error(`backend returned an invalid point at index ${invalidIndex}`)
      smile.value = result
    } else {
      const result = await optionCalcApi.getOptionBoard(
        strategy.assetCode,
        seriesCode,
        strategy.assetType,
        options,
      )
      if (controller.signal.aborted || dataController !== controller) return
      if (!result.rows.length) throw new Error('Бэкенд вернул пустую доску опционов')
      board.value = result.rows
    }
  } catch (reason) {
    if (controller.signal.aborted || dataController !== controller || isAbortError(reason)) return
    if (tab === 'smile') {
      globalThis.console.error('[MOEX Options] IV Smile chart error:', reason)
    } else {
      globalThis.console.error('[MOEX Options] Option board error:', reason)
      marketError.value = reason instanceof Error ? reason.message : 'Ошибка загрузки серии'
    }
  } finally {
    if (dataController === controller) {
      dataController = undefined
      loadingMarket.value = false
    }
  }
}

function handleLegendSelection(event: { selected?: Record<string, boolean> }): void {
  const selected = event.selected?.['Сценарий']
  if (selected !== undefined) scenarioVisible.value = selected
}

watch(
  () => [
    store.activeId,
    store.activeStrategy?.assetCode,
    store.activeStrategy?.assetType,
    store.activeStrategy?.positions.map((position) => position.optionSeriesCode).join(','),
  ],
  () => {
    seriesController?.abort()
    dataController?.abort()
    seriesController = undefined
    dataController = undefined
    seriesLoaded = false
    series.value = []
    selectedSeriesCode.value = ''
    board.value = []
    smile.value = []
    marketError.value = null
    loadingMarket.value = false
    void loadMarketData()
  },
  { immediate: true },
)
watch(selectedSeriesCode, loadSeriesData)
watch(
  activeTab,
  (tab) => {
    store.profileVisible = tab === 'profile'
    dataController?.abort()
    if (tab === 'profile') {
      seriesController?.abort()
      loadingMarket.value = false
      marketError.value = null
    } else if (seriesLoaded) {
      void loadSeriesData()
    } else {
      void loadMarketData()
    }
  },
  { immediate: true },
)
watch(
  () => store.calculation.calculatedAt,
  (calculatedAt) => {
    if (calculatedAt && activeTab.value !== 'profile' && !loadingMarket.value) void loadSeriesData()
  },
)
onBeforeUnmount(() => {
  seriesController?.abort()
  dataController?.abort()
  store.profileVisible = false
})
</script>

<template>
  <section class="market-workspace">
    <div class="workspace-tabs">
      <button :class="{ active: activeTab === 'profile' }" @click="activeTab = 'profile'">
        <LineChartIcon :size="15" /> Профиль
      </button>
      <button :class="{ active: activeTab === 'smile' }" @click="activeTab = 'smile'">
        <BarChart3 :size="15" /> Улыбка IV
      </button>
      <button :class="{ active: activeTab === 'liquidity' }" @click="activeTab = 'liquidity'">
        <Droplets :size="15" /> Ликвидность
      </button>
      <select v-if="activeTab !== 'profile'" v-model="selectedSeriesCode" class="series-select">
        <option
          v-for="item in series"
          :key="item.optionseries_code"
          :value="item.optionseries_code"
        >
          {{ item.expiration_date }} · {{ item.optionseries_code }}
        </option>
      </select>
    </div>

    <div v-if="marketError" class="inline-error">{{ marketError }}</div>

    <template v-if="activeTab === 'profile'">
      <div class="indicator-switcher">
        <span class="indicator-caption">График</span>
        <button
          v-for="(label, key) in indicatorLabels"
          :key="key"
          :class="{ active: indicator === key }"
          @click="indicator = key"
        >
          {{ label }}
        </button>
        <span v-if="chartBounds.spot" class="underlying-price-chip">
          Базовый <strong>{{ formatNumber(chartBounds.spot) }}</strong>
        </span>
      </div>
      <div
        v-if="store.activeStrategy?.marketPrice != null && currentGraph?.now.length"
        class="chart-frame"
        data-testid="profile-chart"
      >
        <VChart :option="profileOption" autoresize @legendselectchanged="handleLegendSelection" />
      </div>
      <div
        v-else-if="store.calculation.loading || store.calculation.graphLoading[indicator]"
        class="chart-empty"
      >
        <LoaderCircle :size="28" class="spinning" /><strong>Расчёт…</strong>
      </div>
      <div v-else class="chart-empty">
        <LineChartIcon :size="28" />
        <strong>Профиль появится после расчёта</strong>
        <span>Добавьте позиции и нажмите «Пересчитать»</span>
      </div>
    </template>

    <div v-else-if="loadingMarket" class="chart-empty">
      <LoaderCircle :size="28" class="spinning" /><strong>Загрузка…</strong>
    </div>
    <template v-else-if="activeTab === 'smile'">
      <div v-if="smile.length" class="smile-source">{{ smileSource }}</div>
      <div v-if="smile.length" class="chart-frame" data-testid="smile-chart">
        <VChart :option="smileOption" autoresize />
      </div>
      <div v-else class="chart-empty">
        <BarChart3 :size="28" /><strong>Нет данных по улыбке</strong
        ><span>Выберите другую серию</span>
      </div>
    </template>

    <div v-else class="liquidity-view">
      <div class="liquidity-summary">
        <span
          ><small>Объём серии</small
          ><strong>{{
            formatCompact(
              (selectedSeries?.call?.volume_contracts ?? 0) +
                (selectedSeries?.put?.volume_contracts ?? 0),
            )
          }}</strong></span
        >
        <span
          ><small>Открытый интерес</small
          ><strong>{{
            formatCompact(
              (selectedSeries?.call?.openposition ?? 0) + (selectedSeries?.put?.openposition ?? 0),
            )
          }}</strong></span
        >
        <span
          ><small>Ликвидных контрактов</small><strong>{{ liquidBoard.length }}</strong></span
        >
      </div>
      <div class="liquidity-table-wrap">
        <table class="liquidity-table">
          <thead>
            <tr>
              <th>SECID</th>
              <th>Страйк</th>
              <th>Bid</th>
              <th>Offer</th>
              <th>Расч. цена</th>
              <th>Спред</th>
              <th>Сделки</th>
              <th>IV</th>
              <th>Оценка</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in liquidBoard" :key="row.secid">
              <td>
                <strong>{{ row.secid }}</strong>
              </td>
              <td>{{ formatNumber(row.strike) }}</td>
              <td>{{ formatNumber(row.bid) }}</td>
              <td>{{ formatNumber(row.offer) }}</td>
              <td>{{ formatNumber(row.theorprice) }}</td>
              <td>
                {{
                  optionSpreadPercent(row) === null ? '—' : formatPercent(optionSpreadPercent(row))
                }}
              </td>
              <td>{{ formatNumber(row.numtrades) }}</td>
              <td>{{ formatPercent(row.volatility) }}</td>
              <td>
                <span class="liquidity-dot" :class="liquidityClass(row)"></span
                >{{ { good: 'Высокая', medium: 'Средняя', poor: 'Низкая' }[liquidityClass(row)] }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
