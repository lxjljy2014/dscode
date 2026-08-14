<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LlmCacheStats, UsageRecord } from '@dscode/shared';
import { host } from '../../bridge/host';

const { t } = useI18n();
const records = ref<UsageRecord[]>([]);
const loading = ref(false);
const cache = ref<LlmCacheStats | null>(null);
const clearing = ref(false);

/** 命中率百分比（0 请求时显示 —） */
const hitRateText = computed(() => {
  const c = cache.value;
  if (!c) return '—';
  return (c.hitRate * 100).toFixed(1) + '%';
});

const totals = computed(() => {
  const prompt = records.value.reduce((s, r) => s + r.promptTokens, 0);
  const completion = records.value.reduce((s, r) => s + r.completionTokens, 0);
  return { prompt, completion, total: prompt + completion, count: records.value.length };
});

function formatNumber(n: number): string {
  return n.toLocaleString();
}

async function load() {
  if (!host) return;
  loading.value = true;
  try {
    records.value = await host.usageList();
    cache.value = await host.cacheStats();
  } finally {
    loading.value = false;
  }
}

/** 清空 LLM 回复缓存（命中率清零，重新积累） */
async function clearCache() {
  if (!host) return;
  clearing.value = true;
  try {
    cache.value = await host.cacheClear();
  } finally {
    clearing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid grid-cols-3 gap-4">
      <VCard class="px-4 py-3.5">
        <div class="text-xs text-muted">{{ t('settingsPage.usage.promptTokens') }}</div>
        <div class="mt-1 text-xl font-semibold">{{ formatNumber(totals.prompt) }}</div>
      </VCard>
      <VCard class="px-4 py-3.5">
        <div class="text-xs text-muted">{{ t('settingsPage.usage.completionTokens') }}</div>
        <div class="mt-1 text-xl font-semibold">{{ formatNumber(totals.completion) }}</div>
      </VCard>
      <VCard class="px-4 py-3.5">
        <div class="text-xs text-muted">{{ t('settingsPage.usage.total') }}</div>
        <div class="mt-1 text-xl font-semibold">{{ formatNumber(totals.total) }}</div>
      </VCard>
    </div>

    <!-- LLM 回复缓存：命中率与节省量（省成本） -->
    <VCard class="px-4 py-3.5">
      <div class="flex items-center justify-between">
        <div class="text-sm font-medium">{{ t('settingsPage.usage.cacheTitle') }}</div>
        <VBtn size="small" variant="text" color="error" :loading="clearing" @click="clearCache">
          {{ t('settingsPage.usage.cacheClear') }}
        </VBtn>
      </div>
      <div v-if="!cache" class="mt-2 text-xs text-faint">{{ t('settingsPage.usage.cacheEmpty') }}</div>
      <div v-else class="mt-3 grid grid-cols-4 gap-4">
        <div>
          <div class="text-xs text-muted">{{ t('settingsPage.usage.cacheHitRate') }}</div>
          <div class="mt-1 text-xl font-semibold">{{ hitRateText }}</div>
        </div>
        <div>
          <div class="text-xs text-muted">{{ t('settingsPage.usage.cacheHits') }}</div>
          <div class="mt-1 text-xl font-semibold">{{ cache.hits }}</div>
          <div class="text-xs text-faint">{{ t('settingsPage.usage.cacheMisses') }} {{ cache.misses }}</div>
        </div>
        <div>
          <div class="text-xs text-muted">{{ t('settingsPage.usage.cacheSaved') }}</div>
          <div class="mt-1 text-xl font-semibold">
            {{ formatNumber(cache.savedPromptTokens + cache.savedCompletionTokens) }}
          </div>
          <div class="text-xs text-faint">{{ t('settingsPage.usage.tokens') }}</div>
        </div>
        <div>
          <div class="text-xs text-muted">{{ t('settingsPage.usage.cacheEntries') }}</div>
          <div class="mt-1 text-xl font-semibold">{{ cache.entries }}</div>
        </div>
      </div>
    </VCard>

    <VCard class="px-4 py-3.5">
      <div class="flex items-center justify-between">
        <div class="text-sm font-medium">{{ t('settingsPage.usage.recent') }}（{{ totals.count }}）</div>
        <VBtn size="small" variant="text" :loading="loading" @click="load">
          {{ t('settingsPage.usage.refresh') }}
        </VBtn>
      </div>

      <div v-if="!records.length" class="py-8 text-center text-sm text-faint">
        {{ t('settingsPage.usage.empty') }}
      </div>
      <div v-else class="mt-2 flex flex-col">
        <div
          v-for="r in records"
          :key="r.id"
          class="flex items-center justify-between gap-4 border-b border-line py-2 last:border-b-0"
        >
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm">{{ r.model }}</div>
            <div class="text-xs text-muted">{{ new Date(r.createdAt).toLocaleString() }}</div>
          </div>
          <div class="shrink-0 text-right text-sm">
            <span class="text-muted">{{ r.promptTokens }}</span>
            <span class="mx-1 text-faint">/</span>
            <span>{{ r.completionTokens }}</span>
          </div>
        </div>
      </div>
    </VCard>
  </div>
</template>
