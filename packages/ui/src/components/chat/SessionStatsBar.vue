<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAgentStore } from '../../stores/agent';
import { useSessionStore } from '../../stores/session';

/**
 * 会话统计条（仿 Claude Code）：输入卡片下方一行 `|` 分隔的指标。
 * 数据来自运行时每次运行结束推送的 SessionStats（跨多次运行累计）。
 */

const { t } = useI18n();
const agentStore = useAgentStore();
const sessionStore = useSessionStore();

const stats = computed(() => agentStore.sessionStats);

/** 消息步数：steps 数组长度（无 steps 的老消息按正文 1 步兜底） */
const steps = computed(() => {
  const s = sessionStore.activeSession;
  if (!s) return 0;
  return s.messages.reduce((n, m) => n + (m.steps?.length ?? (m.content ? 1 : 0)), 0);
});

/** 有实际数据才展示（避免新会话显示 0 轮） */
const show = computed(() => {
  const st = stats.value;
  return !!st && (st.rounds > 0 || st.promptTokens > 0 || st.toolMs > 0);
});

/** 时长：93m24s 风格（<1 分钟显示秒） */
function formatClock(ms: number): string {
  if (ms < 1000) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

/** token 数：652K / 146M */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** 秒数：1.5s（≥100 取整） */
function formatSeconds(ms: number): string {
  const sec = ms / 1000;
  return sec >= 100 ? `${Math.round(sec)}s` : `${sec.toFixed(1)}s`;
}

const firstTokenAvg = computed(() => {
  const st = stats.value;
  if (!st || st.firstTokenCount === 0) return null;
  return formatSeconds(st.firstTokenMsSum / st.firstTokenCount);
});

const tokPerSec = computed(() => {
  const st = stats.value;
  if (!st || st.completionTokens === 0 || st.llmMs === 0) return null;
  return `${Math.round(st.completionTokens / (st.llmMs / 1000))} ${t('chat.sessionStats.tok')}`;
});

const cacheRate = computed(() => {
  const st = stats.value;
  if (!st || st.cacheHits + st.cacheMisses === 0) return null;
  return `${Math.round((st.cacheHits / (st.cacheHits + st.cacheMisses)) * 100)}%`;
});
</script>

<template>
  <div
    v-if="show && stats"
    class="select-none flex flex-wrap items-center justify-center gap-x-2 px-2 pt-1.5 text-xs text-muted"
  >
    <span>{{ stats.rounds }} {{ t('chat.sessionStats.rounds') }} · {{ steps }} {{ t('chat.sessionStats.steps') }}</span>
    <span class="text-faint" aria-hidden="true">|</span>
    <span>
      {{ t('chat.sessionStats.llm') }} {{ formatClock(stats.llmMs) }} · {{ t('chat.sessionStats.tool') }}
      {{ formatClock(stats.toolMs) }}
    </span>
    <template v-if="firstTokenAvg || tokPerSec">
      <span class="text-faint" aria-hidden="true">|</span>
      <span>{{ t('chat.sessionStats.firstToken') }} {{ firstTokenAvg ?? '—' }} · {{ tokPerSec ?? '—' }}</span>
    </template>
    <template v-if="cacheRate">
      <span class="text-faint" aria-hidden="true">|</span>
      <span>{{ t('chat.sessionStats.cacheHit') }} {{ cacheRate }}</span>
    </template>
    <span class="text-faint" aria-hidden="true">|</span>
    <span>
      {{ t('chat.sessionStats.input') }} {{ formatTokens(stats.promptTokens) }} tok ·
      {{ t('chat.sessionStats.output') }} {{ formatTokens(stats.completionTokens) }} tok
    </span>
  </div>
</template>
