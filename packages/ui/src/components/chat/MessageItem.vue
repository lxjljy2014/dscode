<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Message, Session } from '@dscode/shared';
import { renderMarkdown } from '../../utils/markdown';
import { feedback } from '../../utils/feedback';
import { useSessionStore } from '../../stores/session';
import { host } from '../../bridge/host';
import ToolEventCard from './ToolEventCard.vue';

const props = defineProps<{ message: Message; session?: Session | null }>();

const { t } = useI18n();
const sessionStore = useSessionStore();

/** 历史消息兜底：无步骤时直接渲染完整正文的 markdown */
const renderedContent = computed(() => renderMarkdown(props.message.content, t));

/** 已完成步骤的 markdown 缓存：流式仅重渲染最后一个未完成步骤，历史步骤按内容命中缓存避免 O(n²) 重解析 */
const stepHtmlCache = new Map<string, string>();
const STEP_HTML_CACHE_MAX = 300;

function renderTextStep(index: number, content: string): string {
  const steps = props.message.steps;
  // 正在流式的最后一个 text 步骤逐 chunk 增长，需实时重渲染；其余步骤内容稳定，走缓存
  if (props.message.streaming && steps && index === steps.length - 1) return renderMarkdown(content, t);
  const hit = stepHtmlCache.get(content);
  if (hit !== undefined) return hit;
  const html = renderMarkdown(content, t);
  if (stepHtmlCache.size >= STEP_HTML_CACHE_MAX) {
    const first = stepHtmlCache.keys().next().value;
    if (first !== undefined) stepHtmlCache.delete(first);
  }
  stepHtmlCache.set(content, html);
  return html;
}

/** 文本附件（已读取内容，折叠展示；图片/二进制附件走上方预览区） */
const textAttachments = computed(() => props.message.attachments?.filter(a => !!a.content) ?? []);

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

/** 是否为消息里第一个思考行（去掉其顶部间距，避免与头像行之间留空） */
function isFirstReasoning(index: number): boolean {
  const steps = props.message.steps;
  if (!steps) return false;
  return steps.findIndex(s => s.kind === 'reasoning') === index;
}

// ---- 回复底部操作：复制 / 点赞 / 踩 / fork ----

/** 复制状态（短暂显示「已复制」反馈） */
const copied = ref(false);
let copyTimer: number | undefined;

/** 写入剪贴板（clipboard API 优先，非安全上下文兜底 execCommand） */
async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

async function copyContent(): Promise<void> {
  await writeClipboard(props.message.content);
  copied.value = true;
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    copied.value = false;
  }, 1500);
}

/** 代码块 header 按钮事件委托：复制 / 下载（v-html 内按钮无 Vue 绑定） */
function onContentClick(e: MouseEvent): void {
  const btn = (e.target as HTMLElement | null)?.closest?.('[data-action]') as HTMLElement | null;
  if (!btn) return;
  const block = btn.closest('.ds-codeblock') as HTMLElement | null;
  const code = block?.querySelector('code')?.textContent ?? '';
  if (btn.dataset.action === 'copy') {
    void writeClipboard(code).then(() => {
      const icon = btn.querySelector('span');
      if (icon) {
        const prev = icon.className;
        icon.className = 'i-lucide:check';
        window.setTimeout(() => {
          icon.className = prev;
        }, 1500);
      }
    });
  } else if (btn.dataset.action === 'download') {
    if (host) void host.saveFile(btn.dataset.filename ?? 'code.txt', code);
  }
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

/** 毫秒 → 统一以秒为单位（<100s 保留 1 位小数，更长取整），如 0.8秒 / 13.1秒 / 785秒 */
function formatDuration(ms: number): string {
  const v = Math.max(0, ms);
  const sec = v / 1000;
  const s = sec >= 100 ? String(Math.round(sec)) : sec.toFixed(1);
  return `${s}${t('chat.stats.second')}`;
}

/** token 速率：整数 tok/s（无 token 数据或时长为 0 时显示 —） */
function formatTokensPerSec(tokens: number | undefined, durationMs: number): string {
  if (!tokens || durationMs <= 0) return '—';
  return `${Math.round(tokens / (durationMs / 1000))} ${t('chat.stats.tokensPerSec')}`;
}

// 组件卸载时清理「已复制」提示的定时器，避免残留
onBeforeUnmount(() => {
  window.clearTimeout(copyTimer);
});
</script>

<template>
  <div class="ds-fade-in mb-5 flex" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
    <!-- user：右对齐弱气泡 -->
    <div
      v-if="message.role === 'user'"
      class="max-w-[78%] rounded-2xl bg-elevated px-4 py-2.5 text-sm leading-relaxed text-fg"
    >
      <!-- @ 引用文件 + 附件预览 -->
      <div v-if="message.contexts?.length || message.attachments?.length" class="mb-2 flex flex-wrap items-center gap-2">
        <template v-for="c in message.contexts" :key="c.id">
          <div class="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs">
            <span class="i-lucide:at-sign text-3.5 text-primary" />
            <span class="font-mono">{{ c.name }}</span>
          </div>
        </template>
        <template v-for="a in message.attachments" :key="a.id">
          <img
            v-if="a.dataUrl"
            :src="a.dataUrl"
            :alt="a.name"
            class="h-24 w-24 rounded-xl border border-line object-cover shadow-sm"
          />
          <div v-else-if="!a.content" class="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs">
            <span class="i-lucide:file text-3.5 text-muted" />
            <span>{{ a.name }}</span>
          </div>
        </template>
      </div>
      <!-- 文本附件内容（折叠卡片，样式对齐思考折叠卡） -->
      <template v-for="a in textAttachments" :key="a.id">
        <details class="ds-attachment mb-2">
          <summary>
            <span class="ds-attachment-icon i-lucide:file-text" />
            <span class="ds-attachment-name">{{ a.name }}</span>
            <span class="ds-attachment-chevron i-lucide:chevron-right" />
          </summary>
          <pre class="ds-attachment-body">{{ a.content }}</pre>
        </details>
      </template>
      <div v-if="message.content" class="whitespace-pre-wrap">{{ message.content }}</div>
    </div>

    <!-- assistant：通栏文档式 -->
    <div v-else class="w-full flex gap-3">
      <div class="mt-0.5 size-7 shrink-0 flex items-center justify-center rounded-full border border-line text-muted">
        <span class="i-lucide:sparkles text-3.5" />
      </div>
      <div class="min-w-0 flex-1 pt-1 text-sm leading-relaxed text-fg" @click="onContentClick">
        <!-- 有序步骤：思考 → 说话 → 工具，按发生顺序交错 -->
        <!-- eslint-disable vue/no-v-html -->
        <template v-if="message.steps && message.steps.length">
          <template v-for="(step, i) in message.steps" :key="i">
            <!-- 思考（默认折叠；思考中显示旋转 loading 图标，完成显示大脑图标，无背景） -->
            <details
              v-if="step.kind === 'reasoning'"
              class="ds-thought"
              :class="isFirstReasoning(i) ? 'mb-4 mt-1' : 'my-4'"
            >
              <summary :class="{ 'ds-breathe': isCurrentReasoning(i) }">
                <span class="ds-thought-icon">
                  <span v-if="isCurrentReasoning(i)" class="i-lucide:brain-circuit ds-spin" />
                  <span v-else class="i-lucide:brain" />
                </span>
                <span class="ds-thought-summary">{{ reasoningLabel(step.content, isCurrentReasoning(i)) }}</span>
                <span class="ds-thought-chevron i-lucide:chevron-right" />
              </summary>
              <div class="ds-thought-body">{{ step.content }}</div>
            </details>
            <!-- 正文（说话/总结） -->
            <div v-else-if="step.kind === 'text'" class="ds-md" v-html="renderTextStep(i, step.content)" />
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
