<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConfirmDecision } from '@dscode/shared';
import { useAgentStore } from '../../stores/agent';

/**
 * 工具确认卡片：覆盖在输入卡片上（absolute inset-0 盖住父容器）。
 * 列表式三选项（带副标题）：允许一次 / 本次会话允许 / 拒绝（停止整个任务）。
 * 键盘控制：弹出自动聚焦；↑/↓ 移动选中项，Enter 确认，Esc 拒绝（停止任务）。
 */

const { t } = useI18n();
const store = useAgentStore();

const confirm = computed(() => store.pendingConfirm);

/** 主参数展示（command/path/url/query） */
const primaryValue = computed(() => {
  const c = confirm.value;
  if (!c) return '';
  try {
    const parsed = JSON.parse(c.args) as Record<string, unknown>;
    const v = parsed['command'] ?? parsed['path'] ?? parsed['url'] ?? parsed['query'];
    return typeof v === 'string' ? v : v !== undefined && v !== null ? JSON.stringify(v) : '';
  } catch {
    return c.args;
  }
});

const verb = computed(() => (confirm.value ? t('agent.verb.' + confirm.value.name) : ''));

function respond(kind: ConfirmDecision['kind']): void {
  const c = confirm.value;
  if (!c) return;
  store.respondConfirm(c.toolEventId, { kind });
}

/** 三选项顺序（与列表渲染一致，供方向键导航） */
const OPTIONS: { kind: ConfirmDecision['kind'] }[] = [
  { kind: 'allow-once' },
  { kind: 'allow-session' },
  { kind: 'deny' }
];

/** 当前键盘选中的选项下标（↑/↓ 移动，Enter 确认） */
const selected = ref(0);

/** 卡片根元素：弹出时聚焦以接收键盘事件 */
const rootRef = ref<HTMLElement>();

// 卡片出现时聚焦并重置选中；消失后把焦点还给输入框（供继续输入）
watch(confirm, async c => {
  if (c) {
    selected.value = 0;
    await nextTick();
    rootRef.value?.focus();
  }
});

/** 键盘控制：↑/↓ 移动选中项，Enter 确认，Esc 拒绝（停止任务） */
function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return; // 输入法组合中不响应，避免误触发
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      selected.value = (selected.value + 1) % OPTIONS.length;
      break;
    case 'ArrowUp':
      e.preventDefault();
      selected.value = (selected.value - 1 + OPTIONS.length) % OPTIONS.length;
      break;
    case 'Enter':
      respond(OPTIONS[selected.value].kind);
      break;
    case 'Escape':
      respond('deny');
      break;
  }
}
</script>

<template>
  <!-- 覆盖输入卡片：有待确认工具时盖住输入区，处理完即消失；可聚焦以接收键盘控制 -->
  <!-- 底部与输入卡片底部对齐（items-end），覆盖输入卡片 -->
  <div
    v-if="confirm"
    ref="rootRef"
    tabindex="0"
    class="absolute inset-0 z-10 flex items-end justify-center outline-none"
    @keydown="onKeydown"
  >
    <VCard rounded="2xl" class="w-full border border-line bg-elevated" elevation="8">
      <!-- 工具信息：动词 + 主参数 -->
      <div class="flex items-center gap-2 px-3.5 pt-3">
        <span class="i-lucide:shield-alert shrink-0 text-4 text-warning" />
        <span class="shrink-0 text-sm text-muted">{{ verb }}</span>
        <span class="min-w-0 flex-1 truncate font-mono text-sm text-fg">{{ primaryValue }}</span>
      </div>
      <div class="px-3.5 pb-2.5 pt-0.5 text-xs text-faint">{{ t('agent.status.confirming') }}</div>

      <!-- 列表式三选项：允许一次 / 本次会话允许 / 拒绝（停止任务），带副标题说明；↑/↓ 选中高亮 -->
      <VList nav density="compact" class="px-1 pb-1">
        <VListItem
          :class="{ 'bg-primary/12': selected === 0 }"
          prepend-icon="i-lucide:check"
          :title="t('agent.approveOnce')"
          :subtitle="t('agent.approveOnceHint')"
          rounded="lg"
          @click="respond('allow-once')"
          @mouseenter="selected = 0"
        />
        <VDivider class="border-line" />
        <VListItem
          :class="{ 'bg-primary/12': selected === 1 }"
          prepend-icon="i-lucide:clock"
          :title="t('agent.approveSession')"
          :subtitle="t('agent.approveSessionHint')"
          rounded="lg"
          @click="respond('allow-session')"
          @mouseenter="selected = 1"
        />
        <VDivider class="border-line" />
        <VListItem
          :class="{ 'bg-primary/12': selected === 2 }"
          rounded="lg"
          @click="respond('deny')"
          @mouseenter="selected = 2"
        >
          <template #prepend>
            <VIcon icon="i-lucide:ban" class="text-error" />
          </template>
          <VListItemTitle class="text-error">{{ t('agent.deny') }}</VListItemTitle>
          <VListItemSubtitle>{{ t('agent.denyHint') }}</VListItemSubtitle>
        </VListItem>
      </VList>

      <!-- 键位提示 -->
      <div class="select-none px-3.5 pb-2 pt-0.5 text-[11px] text-faint">
        {{ t('agent.keyboardHint') }}
      </div>
    </VCard>
  </div>
</template>
