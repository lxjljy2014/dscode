<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Message } from '@dscode/shared';
import { renderMarkdown } from '../../utils/markdown';
import ToolEventCard from './ToolEventCard.vue';

const props = defineProps<{ message: Message }>();

const { t } = useI18n();

/** 历史消息兜底：无步骤时直接渲染完整正文的 markdown */
const renderedContent = computed(() => renderMarkdown(props.message.content));

/** 流式光标：仅当最后一步是正文时显示（思考中/工具执行中不显示） */
const showCursor = computed(() => {
  if (!props.message.streaming) return false;
  const steps = props.message.steps;
  if (!steps || steps.length === 0) return false;
  return steps[steps.length - 1].kind === 'text';
});

/** 当前正在流式思考的 reasoning step（最后一步是 reasoning 且正在流式） */
function isCurrentReasoning(index: number): boolean {
  if (!props.message.streaming) return false;
  const steps = props.message.steps;
  if (!steps) return false;
  return index === steps.length - 1 && steps[index].kind === 'reasoning';
}

/** 思考块标题：思考/思考中 · 首行摘要（40 字内） */
function reasoningLabel(content: string, streaming: boolean): string {
  const base = streaming ? t('agent.thinkinging') : t('agent.thinking');
  const line = content.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
  const title = line.length > 40 ? line.slice(0, 40) + '…' : line;
  return title ? base + ' · ' + title : base;
}
</script>

<template>
  <div class="ds-fade-in mb-5 flex" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
    <!-- user：右对齐弱气泡 -->
    <div
      v-if="message.role === 'user'"
      class="max-w-[78%] whitespace-pre-wrap rounded-2xl bg-elevated px-4 py-2.5 text-sm leading-relaxed text-fg"
    >
      {{ message.content }}
    </div>

    <!-- assistant：通栏文档式 -->
    <div v-else class="w-full flex gap-3">
      <div class="mt-0.5 size-7 shrink-0 flex items-center justify-center rounded-full border border-line text-muted">
        <span class="i-lucide:sparkles text-3.5" />
      </div>
      <div class="min-w-0 flex-1 pt-1 text-sm leading-relaxed text-fg">
        <!-- 有序步骤：思考 → 说话 → 工具，按发生顺序交错 -->
        <!-- eslint-disable vue/no-v-html -->
        <template v-if="message.steps && message.steps.length">
          <template v-for="(step, i) in message.steps" :key="i">
            <!-- 思考（默认折叠；当前轮思考中带呼吸） -->
            <details v-if="step.kind === 'reasoning'" class="mb-3">
              <summary
                class="cursor-pointer select-none text-sm text-muted hover:text-fg"
                :class="{ 'ds-breathe': isCurrentReasoning(i) }"
              >
                <span class="i-lucide:brain mr-1 align-middle text-3.5" />
                {{ reasoningLabel(step.content, isCurrentReasoning(i)) }}
              </summary>
              <div
                class="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap border-l border-line pl-2.5 text-xs leading-relaxed text-muted"
              >
                {{ step.content }}
              </div>
            </details>
            <!-- 正文（说话/总结） -->
            <div v-else-if="step.kind === 'text'" class="ds-md" v-html="renderMarkdown(step.content)" />
            <!-- 工具调用 -->
            <ToolEventCard v-else :event="step.event" />
          </template>
        </template>
        <!-- 兜底：历史消息无步骤，直接渲染完整正文 -->
        <div v-else-if="message.content" class="ds-md" v-html="renderedContent" />
        <!-- eslint-enable vue/no-v-html -->

        <span v-if="showCursor" class="ds-streaming-cursor" />

        <!-- agent 错误提示（code 映射 i18n 文案；errorDetail 展示主进程附带的真实原因） -->
        <div v-if="message.errorCode" class="mt-2 flex items-center gap-1.5 text-xs text-warning">
          <span class="i-lucide:circle-alert text-3.5" />
          <span>{{ t(`agent.error.${message.errorCode}`) }}</span>
        </div>
        <div v-if="message.errorDetail" class="mt-1 font-mono text-[11px] leading-relaxed text-faint">
          {{ message.errorDetail }}
        </div>
      </div>
    </div>
  </div>
</template>
