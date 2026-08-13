<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { Message } from '@dscode/shared';

defineProps<{ message: Message }>();

const { t } = useI18n();
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
        <div class="whitespace-pre-wrap">{{ message.content }}</div>
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
