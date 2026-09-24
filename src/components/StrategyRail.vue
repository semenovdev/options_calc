<script setup lang="ts">
import { Plus, Trash2 } from '@lucide/vue'
import { usePortfolioStore } from '@/stores/portfolio'

const store = usePortfolioStore()
</script>

<template>
  <aside class="strategy-rail">
    <div class="rail-header">
      <span>Портфели</span>
      <button class="icon-button small" title="Новая стратегия" @click="store.addStrategy">
        <Plus :size="15" />
      </button>
    </div>
    <div class="strategy-list">
      <button
        v-for="strategy in store.strategies"
        :key="strategy.id"
        class="strategy-item"
        :class="{ active: strategy.id === store.activeId }"
        @click="store.selectStrategy(strategy.id)"
      >
        <span class="strategy-meta">
          <span v-if="strategy.assetCode" class="strategy-code">{{ strategy.assetCode }}</span>
          <strong :title="strategy.name">{{ strategy.name }}</strong>
          <small>{{ strategy.positions.length }} позиций</small>
        </span>
        <span
          v-if="store.strategies.length > 1"
          class="delete-strategy"
          role="button"
          tabindex="0"
          title="Удалить стратегию"
          @click.stop="store.removeStrategy(strategy.id)"
          @keydown.enter.stop="store.removeStrategy(strategy.id)"
        >
          <Trash2 :size="14" />
        </span>
      </button>
    </div>
  </aside>
</template>
