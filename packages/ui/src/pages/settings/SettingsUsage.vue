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

/** API 前缀缓存聚合：只统计已记录缓存统计的记录（cacheTracked），历史无统计记录不参与命中率 */
const apiCache = computed(() => {
  const tracked = records.value.filter(r => r.cacheTracked);
  const prompt = tracked.reduce((s, r) => s + r.promptTokens, 0);
  const cached = tracked.reduce((s, r) => s + (r.cachedPromptTokens ?? 0), 0);
  return { prompt, cached, miss: Math.max(prompt - cached, 0), rate: prompt > 0 ? cached / prompt : 0, sampled: tracked.length };
});
const apiCacheRateText = computed(() => {
  if (apiCache.value.sampled === 0) return '—';
  return (apiCache.value.rate * 100).toFixed(1) + '%';
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

    <!-- 缓存统计：API 前缀缓存（按前缀打折计费） + 本地重放缓存（相同请求重放） -->
    <div class="grid gap-4 sm:grid-cols-2">
      <!-- API 前缀缓存：来自每次请求的 usage（DeepSeek 上下文缓存，命中部分打折计费） -->
      <VCard class="px-4 py-3.5">
        <div class="text-sm font-medium">{{ t('settingsPage.usage.apiCacheTitle') }}</div>
        <div class="mt-3 grid grid-cols-2 gap-4">
          <div>
            <div class="text-xs text-muted">{{ t('settingsPage.usage.cacheHitRate') }}</div>
            <div class="mt-1 text-xl font-semibold">{{ apiCacheRateText }}</div>
          </div>
          <div>
            <div class="text-xs text-muted">{{ t('settingsPage.usage.apiCacheHitTokens') }}</div>
            <div class="mt-1 text-xl font-semibold">{{ formatNumber(apiCache.cached) }}</div>
            <div class="text-xs text-faint">
              {{ t('settingsPage.usage.apiCacheSamples') }} {{ apiCache.sampled }} · {{ t('settingsPage.usage.apiCacheMissTokens') }} {{ formatNumber(apiCache.miss) }}
            </div>
          </div>
        </div>
        <div class="mt-3 text-xs leading-5 text-faint">{{ t('settingsPage.usage.apiCacheHint') }}</div>
      </VCard>

      <!-- 本地重放缓存：相同请求（中断重试/重复提问）直接重放，省 API 调用 -->
      <VCard class="px-4 py-3.5">
        <div class="flex items-center justify-between">
          <div class="text-sm font-medium">{{ t('settingsPage.usage.localCacheTitle') }}</div>
          <VBtn size="small" variant="text" color="error" :loading="clearing" @click="clearCache">
            {{ t('settingsPage.usage.cacheClear') }}
          </VBtn>
        </div>
        <div v-if="!cache" class="mt-2 text-xs text-faint">{{ t('settingsPage.usage.cacheEmpty') }}</div>
        <div v-else class="mt-3 grid grid-cols-2 gap-4">
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
        <div class="mt-3 text-xs leading-5 text-faint">{{ t('settingsPage.usage.localCacheHint') }}</div>
      </VCard>
    </div>

    <VCard class="px-4 py-3.5">
      <div class="flex items-center justify-between">
        <div class="text-sm font-medium">{{ t('settingsPage.usage.recent') }} ({{ totals.count }})</div>
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
            <span v-if="r.cacheTracked && r.promptTokens > 0" class="ml-2 shrink-0 text-xs text-tool-read">
              {{ t('settingsPage.usage.cachedRatio', { percent: ((r.cachedPromptTokens ?? 0) / r.promptTokens * 100).toFixed(0) }) }}
            </span>
          </div>
        </div>
      </div>
    </VCard>
  </div>
</template>