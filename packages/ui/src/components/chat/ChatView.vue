<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../../stores/session';
import type { Message } from '@dscode/shared';
import { useAgentStore } from '../../stores/agent';
import ChatInput from './ChatInput.vue';
import ConfirmOverlay from './ConfirmOverlay.vue';
import SessionStatsBar from './SessionStatsBar.vue';
import MessageItem from './MessageItem.vue';

const { t } = useI18n();
const sessionStore = useSessionStore();
const agentStore = useAgentStore();
const { activeSession } = storeToRefs(sessionStore);
const { generating, compacting } = storeToRefs(agentStore);

const messages = computed(() => activeSession.value?.messages ?? []);

interface ChatVirtualScroll {
  $el?: HTMLElement;
  scrollToIndex?: (index: number) => void;
}
const vsRef = ref<ChatVirtualScroll | null>(null);

// 按时段的问候语（空状态展示）
const greeting = computed(() => {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return t('chat.greeting.morning');
  if (h >= 11 && h < 14) return t('chat.greeting.noon');
  if (h >= 14 && h < 18) return t('chat.greeting.afternoon');
  if (h >= 18 && h < 23) return t('chat.greeting.evening');
  return t('chat.greeting.night');
});

/** 距底部该阈值内视为「贴底」，超过则视为用户接管（暂停流式吸底） */
const STICK_THRESHOLD = 64;

/** 是否贴底：贴底时流式内容自动吸底；用户上滚后置 false，接管滚动、停止自动吸底 */
const stickToBottom = ref(true);

/** 用户滚动会话区时，按距底部距离更新贴底状态（scroll 不冒泡，用 capture 在祖先捕获） */
function onScroll(e: Event) {
  const el = e.target as HTMLElement | null;
  // 只关心会话滚动容器自身，忽略内部代码块等子元素的横向滚动
  if (!el || el !== vsRef.value?.$el) return;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  stickToBottom.value = distance <= STICK_THRESHOLD;
}

/** 轻量吸底：流式期间用（仅 scrollTop=scrollHeight，不重排虚拟窗口，避免一跳一跳） */
function scrollToBottom() {
  // 用户上滚接管后不再强制吸底，等用户回到底部再恢复跟随
  if (!stickToBottom.value) return;
  nextTick(() => {
    const el = vsRef.value?.$el;
    if (!el) return;
    const scroll = () => {
      if (stickToBottom.value) el.scrollTop = el.scrollHeight;
    };
    scroll();
    requestAnimationFrame(scroll);
  });
}

/** 强吸底：新消息/切换会话/挂载时用（偏移量未测完，多帧校正 + 延迟兜底到真实底部） */
function scrollToBottomHard() {
  // 显式回到底部：重置接管状态，恢复流式跟随
  stickToBottom.value = true;
  nextTick(() => {
    const vs = vsRef.value;
    const el = vs?.$el;
    if (!el) return;
    const index = messages.value.length - 1;
    // 先把虚拟窗口定位到末尾批次（scrollToIndex 内部会等初始 offset 算完再滚），
    // 再把 scrollTop 校正到真实底部（scrollToIndex 是顶部对齐，不是底部）。
    if (index >= 0) vs?.scrollToIndex?.(index);
    const scroll = () => {
      el.scrollTop = el.scrollHeight;
    };
    scroll();
    // 新增消息时偏移量先按假设高度重算、真实高度由 ResizeObserver 实测后回填（大附件更慢），
    // 仅靠两帧不够，补延迟兜底校正到真实底部，避免停在假设高度的伪底部。
    requestAnimationFrame(() => {
      scroll();
      requestAnimationFrame(() => {
        scroll();
        window.setTimeout(scroll, 200);
        window.setTimeout(scroll, 450);
      });
    });
  });
}

// 新增消息（发送 / fork）→ 强吸底（偏移量未测完，含延迟兜底）
watch(() => messages.value.length, scrollToBottomHard, { flush: 'post' });

// 压缩替换整个消息数组（引用变化，长度可能不变如 4→4，上面的 length watch 不触发）→ 强吸底；
// 普通 push 不换数组引用，不会误触发
watch(messages, scrollToBottomHard, { flush: 'post' });

// 流式内容增长 / 工具事件 → 轻量吸底（不重排虚拟窗口，避免一跳一跳）
watch(
  () => [
    messages.value[messages.value.length - 1]?.content,
    activeSession.value?.toolEvents.length
  ],
  scrollToBottom,
  { flush: 'post' }
);

// 切换会话 / 组件重挂载（设置页返回、重启后恢复）→ 强吸底
watch(activeSession, scrollToBottomHard, { flush: 'post' });

// 压缩状态行在会话流末尾：出现时占高会把贴底视图顶起一小段，轻量吸回
watch(compacting, () => scrollToBottom());

onMounted(() => {
  scrollToBottomHard();
});
</script>

<template>
  <div class="h-full flex flex-col bg-base" @scroll.capture="onScroll">
    <template v-if="messages.length">
      <div class="relative flex min-h-0 flex-1 flex-col">
        <VVirtualScroll ref="vsRef" :items="messages" item-key="id" class="min-h-0">
          <template #default="{ item, index }">
            <div
              class="mx-auto max-w-200 px-6"
              :class="index === 0 ? 'pt-6' : index === messages.length - 1 ? 'pb-6' : ''"
            >
              <MessageItem :message="(item as Message)" :session="activeSession" />
            </div>
          </template>
        </VVirtualScroll>

        <!-- /compact 进行中：会话流末尾的系统状态行（作为会话的一部分，与消息同宽度容器） -->
        <div v-if="compacting" class="ds-fade-in mx-auto w-full max-w-200 shrink-0 px-6 pb-2">
          <div class="flex items-center gap-1.5 text-xs text-muted">
            <span class="i-lucide:loader-circle text-3.5 animate-spin" />
            {{ t('command.compactRunning') }}
          </div>
        </div>
      </div>

      <div class="shrink-0 px-6 pb-3 pt-1">
        <div class="relative mx-auto max-w-200">
          <ChatInput :generating="generating" @send="agentStore.sendMessage" @stop="agentStore.stopGenerating" />
          <!-- 工具确认卡片：覆盖在输入卡片上 -->
          <ConfirmOverlay />
          <!-- 回到底部：圆形悬浮按钮，固定在输入卡片右上方 -->
          <VBtn
            v-if="!stickToBottom"
            icon="i-lucide:chevron-down"
            variant="tonal"
            size="small"
            rounded="circle"
            class="ds-fade-in absolute -top-12 right-4 z-20"
            :aria-label="t('chat.scrollToBottom')"
            :title="t('chat.scrollToBottom')"
            @click="scrollToBottomHard"
          />
        </div>
        <!-- 会话统计条（仿 Claude Code）：输入卡片下方 -->
        <SessionStatsBar class="mx-auto max-w-200" />
      </div>
    </template>

    <!-- 空状态：问候语 + 居中的输入卡片 -->
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-8 px-6">
      <div class="select-none text-center text-2xl font-medium text-fg">{{ greeting }}</div>
      <div class="relative w-full max-w-180">
        <ChatInput :generating="generating" @send="agentStore.sendMessage" @stop="agentStore.stopGenerating" />
        <!-- 工具确认卡片：覆盖在输入卡片上 -->
        <ConfirmOverlay />
      </div>
    </div>
  </div>
</template>
