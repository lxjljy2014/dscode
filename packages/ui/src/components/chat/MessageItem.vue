<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Message, Session } from '@dscode/shared';
import { renderMarkdown } from '../../utils/markdown';
import { useSessionStore } from '../../stores/session';
import ToolEventCard from './ToolEventCard.vue';

const props = defineProps<{ message: Message; session?: Session | null }>();

const { t } = useI18n();
const sessionStore = useSessionStore();

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
  const line =
    content
      .split('\n')
      .map(l => l.trim())
      .find(l => l.length > 0) ?? '';
  const title = line.length > 40 ? line.slice(0, 40) + '…' : line;
  return title ? base + ' · ' + title : base;
}

// ---- 回复底部操作：复制 / 点赞 / 踩 / fork ----

/** 点赞/踩状态（按消息 id，仅内存，不持久化；模块级避免切换任务后丢失） */
const feedback = reactive(new Map<string, 'like' | 'dislike'>());

/** 复制状态（短暂显示「已复制」反馈） */
const copied = ref(false);
let copyTimer: number | undefined;

async function copyContent(): Promise<void> {
  const text = props.message.content;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 兜底：隐藏 textarea + execCommand（非安全上下文等环境）
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  copied.value = true;
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    copied.value = false;
  }, 1500);
}

function toggleFeedback(kind: 'like' | 'dislike'): void {
  const cur = feedback.get(props.message.id);
  if (cur === kind) feedback.delete(props.message.id);
  else feedback.set(props.message.id, kind);
}

/** fork：从该回复派生新任务（复制到此为止的对话并切换过去） */
function fork(): void {
  if (props.session) sessionStore.forkSession(props.session, props.message.id);
}

// ---- 运行统计格式化（时间 / 用时 / 首 token / token 速率） ----

/** 毫秒时间戳 → HH:mm（本地时区，如 01:44） */
function formatClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 毫秒 → 人类可读时长（<1s 用毫秒，<1m 用秒，否则 13分05秒 / 13m05s） */
function formatDuration(ms: number): string {
  const v = Math.max(0, ms);
  const unit = (m: number, s: number) =>
    `${m}${t('chat.stats.minute')}${String(s).padStart(2, '0')}${t('chat.stats.second')}`;
  if (v < 1000) return `${Math.round(v)}${t('chat.stats.millisecond')}`;
  if (v < 60000) return `${(v / 1000).toFixed(1)}${t('chat.stats.second')}`;
  return unit(Math.floor(v / 60000), Math.round((v % 60000) / 1000));
}

/** token 速率：整数 tok/s（无 token 数据或时长为 0 时显示 —） */
function formatTokensPerSec(tokens: number | undefined, durationMs: number): string {
  if (!tokens || durationMs <= 0) return '—';
  return `${Math.round(tokens / (durationMs / 1000))} ${t('chat.stats.tokensPerSec')}`;
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

        <!-- 回复结束后底部操作行：复制 / 点赞 / 踩 / fork；统计内联跟在按钮后，悬停按钮行时才显示 -->
        <div v-if="!message.streaming" class="group/stats mt-1.5 text-xs text-muted">
          <div class="flex items-center gap-x-1">
            <div class="flex items-center gap-0.5 rounded-lg px-1 py-0.5">
              <VTooltip :text="copied ? t('chat.copied') : t('chat.copy')" location="bottom">
                <template #activator="{ props: tip }">
                  <VIconBtn
                    v-bind="tip"
                    :icon="copied ? 'i-lucide:check' : 'i-lucide:copy'"
                    variant="text"
                    size="small"
                    rounded="lg"
                    :class="copied ? 'text-primary' : 'text-muted'"
                    @click="copyContent"
                  />
                </template>
              </VTooltip>
              <VTooltip :text="t('chat.like')" location="bottom">
                <template #activator="{ props: tip }">
                  <VIconBtn
                    v-bind="tip"
                    icon="i-lucide:thumbs-up"
                    variant="text"
                    size="small"
                    rounded="lg"
                    :class="feedback.get(message.id) === 'like' ? 'text-primary' : 'text-muted'"
                    @click="toggleFeedback('like')"
                  />
                </template>
              </VTooltip>
              <VTooltip :text="t('chat.dislike')" location="bottom">
                <template #activator="{ props: tip }">
                  <VIconBtn
                    v-bind="tip"
                    icon="i-lucide:thumbs-down"
                    variant="text"
                    size="small"
                    rounded="lg"
                    :class="feedback.get(message.id) === 'dislike' ? 'text-warning' : 'text-muted'"
                    @click="toggleFeedback('dislike')"
                  />
                </template>
              </VTooltip>
              <VTooltip :text="t('chat.fork')" location="bottom">
                <template #activator="{ props: tip }">
                  <VIconBtn
                    v-bind="tip"
                    icon="i-lucide:git-fork"
                    variant="text"
                    size="small"
                    rounded="lg"
                    class="text-muted"
                    @click="fork"
                  />
                </template>
              </VTooltip>
            </div>

            <!-- 运行统计（内联跟在按钮后，悬停按钮行时展开显示）：01:44 · 用时 13分05秒 · 首 token 1.1秒 · 139 tok/s -->
            <span
              v-if="message.stats"
              class="grid grid-cols-[0fr] opacity-0 transition-all duration-200 group-hover/stats:grid-cols-[1fr] group-hover/stats:opacity-100"
            >
              <span class="min-w-0 overflow-hidden whitespace-nowrap">
                <span class="flex items-center gap-x-1">
                  <span class="select-none text-faint">·</span>
                  <span class="tabular-nums">{{ formatClock(message.stats.endAt) }}</span>
                  <span class="select-none text-faint">·</span>
                  <span>
                    {{ t('chat.stats.duration') }}
                    <span class="tabular-nums">{{ formatDuration(message.stats.endAt - message.stats.startAt) }}</span>
                  </span>
                  <span class="select-none text-faint">·</span>
                  <span>
                    {{ t('chat.stats.firstToken') }}
                    <span class="tabular-nums">
                      {{ message.stats.firstTokenMs !== undefined ? formatDuration(message.stats.firstTokenMs) : '—' }}
                    </span>
                  </span>
                  <span class="select-none text-faint">·</span>
                  <span class="tabular-nums">
                    {{ formatTokensPerSec(message.stats.completionTokens, message.stats.endAt - message.stats.startAt) }}
                  </span>
                </span>
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
