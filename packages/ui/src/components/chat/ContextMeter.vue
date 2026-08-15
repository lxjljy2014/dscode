<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAgentStore } from '../../stores/agent';
import { useSettingsStore } from '../../stores/settings';

/**
 * 上下文占用环形进度（输入卡片发送按钮左侧，对齐官方 ContextMeter）：
 * 已用 = 最近一轮请求的完整 prompt（含缓存命中，运行时 contextTokens），
 * 容量 = 供应商 contextWindow（缺省对齐官方 1M）。
 * 无数据（尚未产生请求）时不渲染。
 */

const { t } = useI18n();
const agentStore = useAgentStore();
const settingsStore = useSettingsStore();

const contextWindow = computed(() => {
  const w = settingsStore.settings.providers[0]?.contextWindow;
  return typeof w === 'number' && w > 0 ? w : 1000000;
});

const contextTokens = computed(() => agentStore.sessionStats?.contextTokens ?? 0);

const percent = computed(() => {
  const used = contextTokens.value;
  const win = contextWindow.value;
  if (!used || used <= 0 || !win) return null;
  return Math.min(100, Math.round((used / win) * 100));
});

/** 占用分级：<70% 正常（primary），70-89% 警示（warning），>=90% 危险（error） */
const color = computed(() => {
  const p = percent.value;
  if (p === null) return 'primary';
  if (p >= 90) return 'error';
  if (p >= 70) return 'warning';
  return 'primary';
});

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

const tooltip = computed(() => {
  if (percent.value === null) return '';
  return t('chat.contextMeter.tooltip', {
    percent: percent.value,
    used: formatTokens(contextTokens.value),
    total: formatTokens(contextWindow.value)
  });
});
</script>

<template>
  <VTooltip v-if="percent !== null" :text="tooltip" location="top">
    <template #activator="{ props: tipProps }">
      <VProgressCircular
        v-bind="tipProps"
        :model-value="percent"
        :size="26"
        :width="2.5"
        :color="color"
        class="mx-1 shrink-0"
      >
        <span class="text-[9px] font-medium text-muted">{{ percent }}%</span>
      </VProgressCircular>
    </template>
  </VTooltip>
</template>
