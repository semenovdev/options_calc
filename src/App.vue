<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Activity, Download, FileJson, Plus, RefreshCw, Wifi } from '@lucide/vue'

import InstrumentComposer from '@/components/InstrumentComposer.vue'
import MarketWorkspace from '@/components/MarketWorkspace.vue'
import PositionTable from '@/components/PositionTable.vue'
import StrategyRail from '@/components/StrategyRail.vue'
import SummaryPanel from '@/components/SummaryPanel.vue'
import { appConfig } from '@/config'
import { usePortfolioStore } from '@/stores/portfolio'
import { exportStrategyCsv, exportStrategyJson } from '@/utils/export'

const store = usePortfolioStore()
const composerOpen = ref(false)
const composerUsesActiveAsset = ref(false)
const hasPositions = computed(() => Boolean(store.activeStrategy?.positions.length))
let refreshTimer: ReturnType<typeof globalThis.setInterval> | undefined

function openComposer(useActiveAsset: boolean): void {
  composerUsesActiveAsset.value = useActiveAsset
  composerOpen.value = true
}

function refreshActiveStrategy(): void {
  if (
    globalThis.document.visibilityState === 'visible' &&
    store.activeStrategy?.positions.length &&
    !store.calculation.loading
  ) {
    void store.calculate()
  }
}

watch(
  () => store.activeId,
  () => {
    if (store.activeStrategy?.positions.length) void store.calculate()
  },
  { immediate: true, flush: 'post' },
)

onMounted(() => {
  refreshTimer = globalThis.setInterval(refreshActiveStrategy, appConfig.autoRefreshIntervalMs)
})

onBeforeUnmount(() => {
  globalThis.clearInterval(refreshTimer)
  store.resetCalculation()
})
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark"><Activity :size="19" /></span>
        <div>
          <strong>MOEX Options</strong>
          <span>Workbench</span>
        </div>
      </div>

      <div class="market-status" title="Источники данных: MOEX ISS и Option Calc">
        <Wifi :size="14" />
        <span>MOEX API</span>
        <i></i>
      </div>

      <div class="topbar-actions">
        <button
          class="icon-button"
          title="Экспорт CSV"
          :disabled="!store.activeStrategy"
          @click="store.activeStrategy && exportStrategyCsv(store.activeStrategy)"
        >
          <Download :size="17" />
        </button>
        <button
          class="icon-button"
          title="Экспорт JSON"
          :disabled="!store.activeStrategy"
          @click="store.activeStrategy && exportStrategyJson(store.activeStrategy)"
        >
          <FileJson :size="17" />
        </button>
        <button
          class="primary-button"
          :disabled="!store.activeStrategy || hasPositions"
          :title="hasPositions ? 'Базовый актив стратегии уже выбран' : 'Добавить инструмент'"
          @click="openComposer(false)"
        >
          <Plus :size="16" /> Добавить инструмент
        </button>
      </div>
    </header>

    <main class="workspace">
      <StrategyRail />

      <section class="content-column">
        <div class="strategy-heading">
          <div>
            <div class="eyebrow">АКТИВНАЯ СТРАТЕГИЯ</div>
            <div class="strategy-title-row">
              <input
                v-if="store.activeStrategy"
                v-model="store.activeStrategy.name"
                class="strategy-name"
                aria-label="Название стратегии"
              />
              <span class="asset-badge">{{ store.activeStrategy?.assetCode }}</span>
            </div>
          </div>
          <button
            class="secondary-button"
            :disabled="!hasPositions || store.calculation.loading"
            @click="store.calculate"
          >
            <RefreshCw :size="15" :class="{ spinning: store.calculation.loading }" />
            {{ store.calculation.loading ? 'Расчёт…' : 'Пересчитать' }}
          </button>
        </div>

        <div v-if="store.calculation.error" class="error-banner" role="alert">
          {{ store.calculation.error }}
        </div>

        <PositionTable @add="openComposer(hasPositions)" />
        <MarketWorkspace />
      </section>

      <SummaryPanel />
    </main>

    <InstrumentComposer v-model:open="composerOpen" :use-active-asset="composerUsesActiveAsset" />
  </div>
</template>
