<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Message } from '@dscode/shared';
import { renderMarkdown } from '../utils/markdown';

const props = defineProps<{ message: Message }>();

const { t } = useI18n();

/** assistant 正文的 markdown 渲染结果（流式期间逐 chunk 重渲染） */
const renderedContent = computed(() => renderMarkdown(props.message.content));
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
        <!-- 思维链（推理模型）：流式期间展开，完成后可折叠 -->
        <details v-if="message.reasoning" class="mb-2" :open="message.streaming">
          <summary class="cursor-pointer select-none text-xs text-faint hover:text-muted">
            <span class="i-lucide:brain mr-1 align-middle text-3.5" />
            {{ t('agent.thinking') }}
          </summary>
          <div class="mt-1 whitespace-pre-wrap border-l border-line pl-2.5 text-xs leading-relaxed text-muted">
            {{ message.reasoning }}
          </div>
        </details>
        <!-- v-html 豁免：markdown-it html:false 转义原始 HTML，且默认阻断 javascript:/file: 等协议链接 -->
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-if="message.content" class="ds-md" v-html="renderedContent" />
        <span v-if="message.streaming" class="ds-streaming-cursor" />
        <!-- agent 错误提示（code 映射 i18n 文案） -->
        <div v-if="message.errorCode" class="mt-2 flex items-center gap-1.5 text-xs text-warning">
          <span class="i-lucide:circle-alert text-3.5" />
          <span>{{ t(`agent.error.${message.errorCode}`) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
