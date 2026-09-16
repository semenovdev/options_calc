<script setup lang="ts">
import { computed } from 'vue'
import { Activity, ArrowRight, CalendarClock, Gauge, ShieldCheck } from '@lucide/vue'

import { usePortfolioStore } from '@/stores/portfolio'
import { formatMoney, signed } from '@/utils/format'

const store = usePortfolioStore()
const totals = computed(() => store.calculation.portfolio?.total)
const deltaHedge = computed(() => Math.round(-(totals.value?.delta ?? 0)))
const vegaHedge = computed(() => -(totals.value?.vega ?? 0))

function addDeltaHedge(): void {
  const strategy = store.activeStrategy
  if (!strategy || strategy.assetType !== 'share' || !deltaHedge.value) return
  store.addPosition({
    secid: strategy.assetCode,
    type: 'share',
    quantity: deltaHedge.value,
    price: strategy.marketPrice ?? undefined,
    nettedIm: true,
    title: 'Delta hedge',
  })
  void store.calculate()
}
</script>

<template>
  <aside class="summary-panel">
    <div class="summary-block pnl-block">
      <div class="eyebrow">P&L ПОЗИЦИИ</div>
      <strong
        class="pnl-value"
        :class="{
          positive: (totals?.profit_and_loss_rub ?? 0) > 0,
          negative: (totals?.profit_and_loss_rub ?? 0) < 0,
        }"
      >
        {{ formatMoney(totals?.profit_and_loss_rub) }}
      </strong>
      <span>Маржа {{ formatMoney(store.calculation.portfolio?.initial_margin) }}</span>
    </div>

    <div class="summary-block">
      <div class="block-heading"><Activity :size="15" /><span>Греки портфеля</span></div>
      <div class="greeks-grid">
        <div>
          <small>Delta</small><strong>{{ signed(totals?.delta) }}</strong>
        </div>
        <div>
          <small>Gamma</small><strong>{{ signed(totals?.gamma) }}</strong>
        </div>
        <div>
          <small>Vega</small><strong>{{ signed(totals?.vega) }}</strong>
        </div>
        <div>
          <small>Theta</small><strong>{{ signed(totals?.theta) }}</strong>
        </div>
        <div>
          <small>Rho</small><strong>{{ signed(totals?.rho) }}</strong>
        </div>
        <div>
          <small>Комиссия</small><strong>{{ formatMoney(totals?.fee) }}</strong>
        </div>
      </div>
    </div>

    <div class="summary-block">
      <div class="block-heading"><ShieldCheck :size="15" /><span>Хеджирование</span></div>
      <div class="hedge-card">
        <span class="hedge-icon delta"><Gauge :size="16" /></span>
        <div>
          <small>Delta hedge</small
          ><strong>{{ signed(deltaHedge) }} {{ store.activeStrategy?.assetCode }}</strong>
        </div>
        <button
          v-if="store.activeStrategy?.assetType === 'share' && deltaHedge"
          class="icon-button small"
          title="Добавить дельта-хедж"
          @click="addDeltaHedge"
        >
          <ArrowRight :size="15" />
        </button>
      </div>
      <div class="hedge-card">
        <span class="hedge-icon vega"><Activity :size="16" /></span>
        <div>
          <small>Целевая Vega</small><strong>{{ signed(vegaHedge) }}</strong>
        </div>
      </div>
      <p class="hedge-note">
        Vega-хедж подбирается опционом выбранной серии с противоположной экспозицией.
      </p>
    </div>

    <div class="summary-block scenario-block">
      <div class="block-heading"><CalendarClock :size="15" /><span>Сценарий</span></div>
      <label class="field-label"
        >Дата расчёта
        <input
          v-if="store.activeStrategy"
          v-model="store.activeStrategy.calculationDate"
          type="date"
        />
      </label>
      <label class="field-label"
        >Сдвиг IV, п.п.
        <input
          v-if="store.activeStrategy"
          v-model.number="store.activeStrategy.volatilityShift"
          type="number"
          step="0.5"
        />
      </label>
      <button
        class="secondary-button full"
        :disabled="!store.activeStrategy?.positions.length"
        @click="store.calculate"
      >
        Применить сценарий
      </button>
    </div>
  </aside>
</template>
