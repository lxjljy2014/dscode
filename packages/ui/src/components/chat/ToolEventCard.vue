<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AgentToolEvent } from '@dscode/shared';
import { useSessionStore } from '../../stores/session';

/**
 * 工具事件卡：聊天流内的紧凑行（工具图标 + 名称 + 参数摘要 + 状态），可展开查看完整参数与结果；
 * confirming 状态内嵌「允许/拒绝」按钮（对应权限门控确认）。
 */

const props = defineProps<{ event: AgentToolEvent }>();

const { t } = useI18n();
const store = useSessionStore();

const expanded = ref(false);

/** 工具图标（按工具名映射 Lucide 图标） */
const TOOL_ICONS: Record<string, string> = {
  read_file: 'i-lucide:file-text',
  list_dir: 'i-lucide:folder-tree',
  search: 'i-lucide:search',
  run_command: 'i-lucide:terminal',
  write_file: 'i-lucide:file-plus-2',
  edit_file: 'i-lucide:file-pen'
};

/** 状态图标与颜色 */
const STATUS_META: Record<AgentToolEvent['status'], { icon: string; cls: string }> = {
  running: { icon: 'i-lucide:loader-circle ds-spin', cls: 'text-primary' },
  done: { icon: 'i-lucide:check', cls: 'text-diff-add' },
  error: { icon: 'i-lucide:x', cls: 'text-diff-del' },
  confirming: { icon: 'i-lucide:clock', cls: 'text-warning' },
  denied: { icon: 'i-lucide:ban', cls: 'text-faint' }
};

const meta = computed(() => STATUS_META[props.event.status] ?? STATUS_META.done);
const toolLabel = computed(() => t(`agent.tool.${props.event.name}`));
const statusLabel = computed(() => t(`agent.status.${props.event.status}`));

/** 单行参数摘要（JSON 压缩后截断） */
const argsSummary = computed(() => {
  try {
    const parsed = JSON.parse(props.event.args) as Record<string, unknown>;
    const kv = Object.entries(parsed)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    return kv.length > 80 ? `${kv.slice(0, 80)}…` : kv;
  } catch {
    return props.event.args.length > 80 ? `${props.event.args.slice(0, 80)}…` : props.event.args;
  }
});

/** 美化后的参数 JSON（展开区展示） */
const prettyArgs = computed(() => {
  try {
    return JSON.stringify(JSON.parse(props.event.args), null, 2);
  } catch {
    return props.event.args;
  }
});
</script>

<template>
  <div class="mb-2 flex">
    <div class="mt-0.5 size-7 shrink-0 flex items-center justify-center rounded-full border border-line text-muted">
      <span class="i-lucide:wrench text-3.5" />
    </div>
    <div class="min-w-0 flex-1">
      <div
        class="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-elevated px-2.5 py-1 text-xs text-muted hover:border-accent-line"
        @click="expanded = !expanded"
      >
        <span class="shrink-0 text-3.5" :class="[TOOL_ICONS[event.name] ?? 'i-lucide:wrench']" />
        <span class="shrink-0 font-medium">{{ toolLabel }}</span>
        <span class="truncate font-mono text-[11px]">{{ argsSummary }}</span>
        <span class="shrink-0 text-3.5" :class="[meta.icon, meta.cls]" />
        <span class="shrink-0 text-faint">{{ statusLabel }}</span>
        <span class="shrink-0 text-faint" :class="expanded ? 'i-lucide:chevron-up' : 'i-lucide:chevron-down'" />
      </div>

      <!-- 权限确认按钮 -->
      <div v-if="event.status === 'confirming'" class="mt-1.5 flex gap-2">
        <VBtn size="x-small" color="primary" @click="store.respondConfirm(event.id, true)">
          {{ t('agent.allow') }}
        </VBtn>
        <VBtn size="x-small" variant="outlined" @click="store.respondConfirm(event.id, false)">
          {{ t('agent.deny') }}
        </VBtn>
      </div>

      <!-- 展开区：完整参数与结果 -->
      <div v-if="expanded" class="mt-1.5 rounded-lg border border-line bg-elevated p-2.5">
        <div class="mb-1 text-[11px] text-faint">{{ t('agent.args') }}</div>
        <pre class="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg">{{
          prettyArgs
        }}</pre>
        <template v-if="event.summary || event.error">
          <div class="mt-2 mb-1 text-[11px] text-faint">{{ t('agent.result') }}</div>
          <pre
            class="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg"
          >{{ event.error ?? event.summary }}</pre>
        </template>
      </div>
    </div>
  </div>
</template>
