<script setup lang="ts">
import { computed } from 'vue'
import { Plus, Trash2 } from '@lucide/vue'

import { usePortfolioStore } from '@/stores/portfolio'
import { formatNumber } from '@/utils/format'

defineEmits<{ add: [] }>()
const store = usePortfolioStore()
const positions = computed(() => store.activeStrategy?.positions ?? [])
const calculatedBySecid = computed(
  () =>
    new Map(
      (store.calculation.portfolio?.positions ?? []).map((position) => [position.secid, position]),
    ),
)

function typeLabel(type: string): string {
  return (
    {
      option: 'Опцион',
      futures: 'Фьючерс',
      share: 'Акция',
      currency: 'Валюта',
      commodity: 'Товар',
    }[type] ?? type
  )
}

function positionVolatility(secid: string): number | null | undefined {
  return calculatedBySecid.value.get(secid)?.volatility
}

function focusPosition(id: string): void {
  store.focusedPositionId = store.focusedPositionId === id ? null : id
  void store.calculate()
}

function updateNumber(id: string, field: 'quantity' | 'price', event: globalThis.Event): void {
  const value = Number((event.target as globalThis.HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  store.updatePosition(id, { [field]: value })
  void store.calculate()
}
</script>

<template>
  <section class="positions-section">
    <div class="section-title">
      <div>
        <h2>Позиции</h2>
        <span>Клик по строке изолирует позицию на графиках</span>
      </div>
      <button v-if="positions.length" class="text-button" @click="$emit('add')">
        <Plus :size="14" /> Добавить
      </button>
    </div>

    <div v-if="positions.length" class="table-wrap">
      <table class="positions-table">
        <thead>
          <tr>
            <th>Инструмент</th>
            <th>Тип</th>
            <th>Экспирация</th>
            <th class="numeric">Кол-во</th>
            <th class="numeric">Цена</th>
            <th class="numeric">Расч. цена</th>
            <th class="numeric">IV</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="position in positions"
            :key="position.id"
            :class="{ focused: store.focusedPositionId === position.id }"
            @click="focusPosition(position.id)"
          >
            <td>
              <strong>{{ position.secid }}</strong>
              <small v-if="position.strike">
                {{ formatNumber(position.strike) }} · {{ position.optionType?.toUpperCase() }}
              </small>
            </td>
            <td>
              <span class="type-chip">{{ typeLabel(position.type) }}</span>
            </td>
            <td>{{ position.expirationDate ?? '—' }}</td>
            <td class="numeric">
              <input
                class="cell-input quantity"
                type="number"
                :value="position.quantity"
                @click.stop
                @change="updateNumber(position.id, 'quantity', $event)"
              />
            </td>
            <td class="numeric">
              <input
                class="cell-input price"
                type="number"
                step="any"
                :value="position.price"
                @click.stop
                @change="updateNumber(position.id, 'price', $event)"
              />
            </td>
            <td class="numeric theor-price">
              {{ formatNumber(calculatedBySecid.get(position.secid)?.theorprice) }}
            </td>
            <td class="numeric">
              {{
                positionVolatility(position.secid) != null
                  ? `${formatNumber(positionVolatility(position.secid))}%`
                  : '—'
              }}
            </td>
            <td class="action-cell">
              <button
                class="icon-button small danger"
                title="Удалить позицию"
                @click.stop="store.removePosition(position.id)"
              >
                <Trash2 :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <button v-else class="empty-positions" @click="$emit('add')">
      <span class="empty-plus"><Plus :size="20" /></span>
      <strong>Добавьте первую позицию</strong>
      <small>Опцион, фьючерс или акция из каталога MOEX</small>
    </button>
  </section>
</template>
