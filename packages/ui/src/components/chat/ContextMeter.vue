<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAgentStore } from '../../stores/agent';
import { useSettingsStore } from '../../stores/settings';

/**
 * 上下文占用（发送按钮左侧，对齐官方 DSH ContextMeter）：
 * 中性环形进度按钮；点击弹出卡片：标题行（已用 + 百分比 + ~已用/总量）→ 分段进度条 → 构成明细（色块 + 数值）。
 * 已用 = 最近一轮请求的完整 prompt（contextTokens），容量 = 供应商 contextWindow（缺省 1M）。
 * 无数据（尚未产生请求）时不渲染。
 */

const { t } = useI18n();
const agentStore = useAgentStore();
const settingsStore = useSettingsStore();

const contextWindow = computed(() => {
  const w = settingsStore.settings.providers[0]?.contextWindow;
  return typeof w === 'number' && w > 0 ? w : 1000000;
});

const stats = computed(() => agentStore.sessionStats);
const contextTokens = computed(() => stats.value?.contextTokens ?? 0);
const systemTokens = computed(() => stats.value?.systemTokens ?? 0);
const toolsTokens = computed(() => stats.value?.toolsTokens ?? 0);
const messagesTokens = computed(() => stats.value?.messagesTokens ?? 0);

const percent = computed(() => {
  const used = contextTokens.value;
  const win = contextWindow.value;
  if (!used || used <= 0 || !win) return null;
  return Math.min(100, Math.round((used / win) * 100));
});

/** 数值格式化：>=1M 用 M、>=1K 用 K（<100K 保留 1 位小数，如 9.3K），否则原样 */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
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

// 环形进度（中性色：轨道淡线、填充次要色）
const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ringDash = computed(() => {
  const p = percent.value ?? 0;
  return (CIRCUMFERENCE * p) / 100 + ' ' + CIRCUMFERENCE;
});

/** 构成明细行（system/tools/messages 各一色块） */
const rows = computed(() => [
  { key: 'system', label: 'chat.contextMeter.system', value: systemTokens.value, color: 'rgb(var(--v-theme-tool-read))' },
  { key: 'tools', label: 'chat.contextMeter.tools', value: toolsTokens.value, color: 'rgb(var(--v-theme-tool-run))' },
  { key: 'messages', label: 'chat.contextMeter.messages', value: messagesTokens.value, color: 'rgb(var(--v-theme-tool-list))' }
]);

const hasBreakdown = computed(() => rows.value.reduce((s, r) => s + r.value, 0) > 0);

/** 分段进度条：各构成按占比着色（无明细时单段中性色） */
const segments = computed(() => {
  const p = percent.value ?? 0;
  const total = rows.value.reduce((s, r) => s + r.value, 0);
  if (total === 0) return [{ key: 'total', width: p, color: null as string | null }];
  return rows.value
    .map(r => ({ key: r.key, width: (p * r.value) / total, color: r.color }))
    .filter(s => s.width > 0);
});
</script>

<template>
  <VMenu v-if="percent !== null" location="top end" :offset="8">
    <template #activator="{ props: menuProps }">
      <VBtn
        v-tooltip="{ text: tooltip, location: 'top' }"
        v-bind="menuProps"
        variant="text"
        size="x-small"
        icon
        rounded="50%"
        class="text-muted"
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
          <circle cx="7" cy="7" :r="RADIUS" fill="none" stroke="rgba(var(--v-theme-on-surface), 0.12)" stroke-width="2" />
          <circle
            cx="7"
            cy="7"
            :r="RADIUS"
            fill="none"
            stroke="rgba(var(--v-theme-on-surface), 0.55)"
            stroke-width="2"
            stroke-linecap="round"
            :stroke-dasharray="ringDash"
            transform="rotate(-90 7 7)"
          />
        </svg>
      </VBtn>
    </template>

    <VCard min-width="264" rounded="12px" class="border border-line bg-surface px-3 py-3">
      <!-- 标题行：已用 + 百分比 · ~已用/总量 -->
      <div class="flex items-center gap-1.5 text-xs">
        <span class="text-faint">{{ t('chat.contextMeter.title') }}</span>
        <span class="font-medium text-fg">{{ percent }}%</span>
        <span class="ml-auto font-medium tabular-nums text-fg">
          {{ t('chat.contextMeter.caption', { used: formatTokens(contextTokens), total: formatTokens(contextWindow) }) }}
        </span>
      </div>

      <!-- 分段进度条 -->
      <div class="mt-2.5 flex h-1 gap-px overflow-hidden rounded-full" style="background: rgba(var(--v-theme-on-surface), 0.08)">
        <div
          v-for="s in segments"
          :key="s.key"
          class="h-full"
          :style="{ width: s.width + '%', background: s.color ?? 'rgba(var(--v-theme-on-surface), 0.5)' }"
        />
      </div>

      <!-- 构成明细 -->
      <div v-if="hasBreakdown" class="mt-2.5">
        <div v-for="r in rows" :key="r.key" class="flex items-center justify-between gap-3 py-0.5 text-xs">
          <span class="flex items-center gap-1.5 text-muted">
            <span class="inline-block size-2 rounded-sm" :style="{ background: r.color }" />
            {{ t(r.label) }}
          </span>
          <span class="tabular-nums text-fg">~{{ formatTokens(r.value) }}</span>
        </div>
      </div>
    </VCard>
  </VMenu>
</template>
