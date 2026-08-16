<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAgentStore } from '../../stores/agent';
import { useSettingsStore } from '../../stores/settings';

/**
 * 上下文占用（输入卡片发送按钮左侧，对齐官方 ContextMeter）：
 * 按钮内嵌环形进度展示当前占用比例，点击弹出菜单展示上下文的构成明细
 * （系统提示词 / 工具 schema / 对话消息 各自对上下文的占用）。
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

const stats = computed(() => agentStore.sessionStats);
const contextTokens = computed(() => stats.value?.contextTokens ?? 0);

/** 上下文构成明细（估算值，总和 ≈ contextTokens） */
const systemTokens = computed(() => stats.value?.systemTokens ?? 0);
const toolsTokens = computed(() => stats.value?.toolsTokens ?? 0);
const messagesTokens = computed(() => stats.value?.messagesTokens ?? 0);
/** 是否已有构成明细（旧会话数据可能缺失，无明细时菜单只展示总数/容量） */
const hasBreakdown = computed(() => systemTokens.value + toolsTokens.value + messagesTokens.value > 0);

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
  <VMenu v-if="percent !== null" location="top end" :offset="4">
    <template #activator="{ props: menuProps }">
      <VBtn
        v-tooltip="{ text: tooltip, location: 'top' }"
        v-bind="menuProps"
        variant="text"
        size="x-small"
        class="text-muted"
      >
        <VProgressCircular :model-value="percent" :size="16" :width="2" :color="color" />
      </VBtn>
    </template>

    <VList min-width="232" nav density="compact">
      <!-- 标题 + 占用百分比 -->
      <VListItem>
        <VListItemTitle class="text-sm font-medium">{{ t('chat.contextMeter.title') }}</VListItemTitle>
        <template #append>
          <span class="text-sm font-medium">{{ percent }}%</span>
        </template>
      </VListItem>
      <!-- 占用进度条（下方附已用/窗口） -->
      <div class="px-4 pb-1">
        <VProgressLinear :model-value="percent" :color="color" height="6" rounded />
        <div class="mt-1 text-xs text-muted">
          {{ t('chat.contextMeter.caption', { used: formatTokens(contextTokens), total: formatTokens(contextWindow) }) }}
        </div>
      </div>

      <!-- 上下文构成明细 -->
      <template v-if="hasBreakdown">
        <VDivider class="my-1" />
        <VListItem>
          <VListItemTitle class="text-xs text-muted">{{ t('chat.contextMeter.system') }}</VListItemTitle>
          <template #append>
            <span class="text-xs">{{ formatTokens(systemTokens) }}</span>
          </template>
        </VListItem>
        <VListItem>
          <VListItemTitle class="text-xs text-muted">{{ t('chat.contextMeter.tools') }}</VListItemTitle>
          <template #append>
            <span class="text-xs">{{ formatTokens(toolsTokens) }}</span>
          </template>
        </VListItem>
        <VListItem>
          <VListItemTitle class="text-xs text-muted">{{ t('chat.contextMeter.messages') }}</VListItemTitle>
          <template #append>
            <span class="text-xs">{{ formatTokens(messagesTokens) }}</span>
          </template>
        </VListItem>
      </template>
    </VList>
  </VMenu>
</template>
