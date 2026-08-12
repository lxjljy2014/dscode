<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '../stores/session'
import ChatInput from './ChatInput.vue'
import MessageItem from './MessageItem.vue'

const { t } = useI18n()
const store = useSessionStore()
const { activeSession, generating } = storeToRefs(store)

const messages = computed(() => activeSession.value?.messages ?? [])
const listRef = ref<HTMLElement>()

// 按时段的问候语（空状态展示）
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h >= 5 && h < 11) return t('chat.greeting.morning')
  if (h >= 11 && h < 14) return t('chat.greeting.noon')
  if (h >= 14 && h < 18) return t('chat.greeting.afternoon')
  if (h >= 18 && h < 23) return t('chat.greeting.evening')
  return t('chat.greeting.night')
})

function scrollToBottom() {
  nextTick(() => {
    const el = listRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(
  () => [messages.value.length, messages.value[messages.value.length - 1]?.content],
  scrollToBottom,
  { flush: 'post' }
)

watch(activeSession, scrollToBottom, { flush: 'post' })
</script>

<template>
  <div class="h-full flex flex-col bg-base">
    <template v-if="messages.length">
      <div ref="listRef" class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto max-w-200 px-6 py-6">
          <MessageItem v-for="m in messages" :key="m.id" :message="m" />
          <div class="h-2" />
        </div>
      </div>

      <div class="shrink-0 px-6 pb-4 pt-1">
        <ChatInput
          class="mx-auto max-w-200"
          :generating="generating"
          @send="store.sendMessage"
          @stop="store.stopGenerating"
        />
      </div>
    </template>

    <!-- 空状态：问候语 + 居中的输入卡片 -->
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-8 px-6">
      <div class="select-none text-center text-2xl font-medium text-fg">{{ greeting }}</div>
      <ChatInput
        class="w-full max-w-180"
        :generating="generating"
        @send="store.sendMessage"
        @stop="store.stopGenerating"
      />
    </div>
  </div>
</template>
