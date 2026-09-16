<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EChartsOption } from 'echarts'
import { BarChart3, Droplets, LineChart as LineChartIcon } from '@lucide/vue'

import { getMarketPrice } from '@/api/iss'
import { optionCalcApi } from '@/api/optionCalc'
import { usePortfolioStore } from '@/stores/portfolio'
import type { IndicatorType, OptionBoardRow, OptionSeries, VolatilityPoint } from '@/types/moex'
import { formatCompact, formatNumber, formatPercent, todayMoscow } from '@/utils/format'

type WorkspaceTab = 'profile' | 'smile' | 'liquidity'
const store = usePortfolioStore()
const activeTab = ref<WorkspaceTab>('profile')
const indicator = ref<IndicatorType>('profit_and_loss')
const series = ref<OptionSeries[]>([])
const selectedSeriesCode = ref('')
const board = ref<OptionBoardRow[]>([])
const smile = ref<VolatilityPoint[]>([])
const loadingMarket = ref(false)
const marketError = ref<string | null>(null)

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

const baseChartStyle: EChartsOption = {
  backgroundColor: 'transparent',
  animationDuration: 350,
  textStyle: { fontFamily: 'Inter, Arial, sans-serif', color: '#9ba5b4' },
  grid: { left: 14, right: 24, top: 36, bottom: 28, containLabel: true },
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
  const markLine = store.activeStrategy?.marketPrice
    ? {
        silent: true,
        symbol: 'none',
        lineStyle: { color: '#f0b44d', type: 'dashed' as const },
        data: [{ xAxis: store.activeStrategy.marketPrice, name: 'Spot' }],
      }
    : undefined
  return {
    ...baseChartStyle,
    series: [
      {
        name: 'Сейчас',
        type: 'line',
        showSymbol: false,
        smooth: 0.16,
        data: graph?.now.map((point) => [point.underlying_price, point.value]) ?? [],
        lineStyle: { width: 2, color: '#45d2a4' },
        itemStyle: { color: '#45d2a4' },
        areaStyle: { color: 'rgba(69,210,164,.08)' },
        markLine,
      },
      {
        name: 'На экспирацию',
        type: 'line',
        showSymbol: false,
        data: graph?.on_expiration.map((point) => [point.underlying_price, point.value]) ?? [],
        lineStyle: { width: 2, color: '#5f8ff7' },
        itemStyle: { color: '#5f8ff7' },
      },
      ...(graph?.on_what_if?.length
        ? [
            {
              name: 'Сценарий',
              type: 'line' as const,
              showSymbol: false,
              data: graph.on_what_if.map((point) => [point.underlying_price, point.value]),
              lineStyle: { width: 2, color: '#d592ff', type: 'dashed' as const },
              itemStyle: { color: '#d592ff' },
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

function spread(row: OptionBoardRow): number | null {
  if (!row.bid || !row.offer || row.offer <= 0) return null
  return ((row.offer - row.bid) / ((row.offer + row.bid) / 2)) * 100
}

function liquidityClass(row: OptionBoardRow): string {
  const value = spread(row)
  if (!row.bid || !row.offer || !row.numtrades) return 'poor'
  if (value !== null && value > 10) return 'medium'
  return 'good'
}

async function loadMarketData(): Promise<void> {
  const strategy = store.activeStrategy
  if (!strategy) return
  loadingMarket.value = true
  marketError.value = null
  try {
    series.value = await optionCalcApi.getSeries(strategy.assetCode, strategy.assetType)
    series.value.sort((a, b) => a.expiration_date.localeCompare(b.expiration_date))
    if (!series.value.some((item) => item.optionseries_code === selectedSeriesCode.value)) {
      const today = todayMoscow()
      selectedSeriesCode.value =
        series.value.find((item) => item.expiration_date >= today)?.optionseries_code ??
        series.value[0]?.optionseries_code ??
        ''
    }
    try {
      strategy.marketPrice = (await getMarketPrice(strategy.assetCode)).price
    } catch {
      strategy.marketPrice = null
    }
  } catch (reason) {
    marketError.value = reason instanceof Error ? reason.message : 'Ошибка загрузки рыночных данных'
  } finally {
    loadingMarket.value = false
  }
}

async function loadSeriesData(): Promise<void> {
  const strategy = store.activeStrategy
  if (!strategy || !selectedSeriesCode.value) return
  loadingMarket.value = true
  marketError.value = null
  try {
    const [boardResult, smileResult] = await Promise.allSettled([
      optionCalcApi.getOptionBoard(
        strategy.assetCode,
        selectedSeriesCode.value,
        strategy.assetType,
      ),
      optionCalcApi.getVolatilityGraph(
        strategy.assetCode,
        selectedSeriesCode.value,
        strategy.assetType,
      ),
    ])
    if (boardResult.status === 'fulfilled') board.value = boardResult.value
    if (smileResult.status === 'fulfilled') smile.value = smileResult.value
    if (boardResult.status === 'rejected' && smileResult.status === 'rejected') {
      throw boardResult.reason
    }
  } catch (reason) {
    marketError.value = reason instanceof Error ? reason.message : 'Ошибка загрузки серии'
  } finally {
    loadingMarket.value = false
  }
}

watch(() => store.activeId, loadMarketData, { immediate: true })
watch(selectedSeriesCode, loadSeriesData)
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

    <div v-if="marketError && activeTab !== 'profile'" class="inline-error">{{ marketError }}</div>

    <template v-if="activeTab === 'profile'">
      <div class="indicator-switcher">
        <button
          v-for="(label, key) in indicatorLabels"
          :key="key"
          :class="{ active: indicator === key }"
          @click="indicator = key"
        >
          {{ label }}
        </button>
      </div>
      <div v-if="currentGraph?.now.length" class="chart-frame">
        <VChart :option="profileOption" autoresize />
      </div>
      <div v-else class="chart-empty">
        <LineChartIcon :size="28" />
        <strong>Профиль появится после расчёта</strong>
        <span>Добавьте позиции и нажмите «Пересчитать»</span>
      </div>
    </template>

    <template v-else-if="activeTab === 'smile'">
      <div v-if="smile.length" class="chart-frame"><VChart :option="smileOption" autoresize /></div>
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
          ><small>Контрактов</small><strong>{{ board.length }}</strong></span
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
              <th>Спред</th>
              <th>Сделки</th>
              <th>IV</th>
              <th>Оценка</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in board" :key="row.secid">
              <td>
                <strong>{{ row.secid }}</strong>
              </td>
              <td>{{ formatNumber(row.strike) }}</td>
              <td>{{ formatNumber(row.bid) }}</td>
              <td>{{ formatNumber(row.offer) }}</td>
              <td>{{ spread(row) === null ? '—' : formatPercent(spread(row)) }}</td>
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
