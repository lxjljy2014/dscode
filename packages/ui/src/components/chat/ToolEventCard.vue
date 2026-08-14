<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AgentToolEvent, ConfirmDecision } from '@dscode/shared';
import { useAgentStore } from '../../stores/agent';
import { useSettingsStore } from '../../stores/settings';

const props = defineProps<{ event: AgentToolEvent }>();

const { t } = useI18n();
const store = useAgentStore();
const settingsStore = useSettingsStore();

const expanded = ref(false);

/** 展开/折叠：点击行内文字或右侧小箭头触发（不整行响应点击） */
function toggle(): void {
  expanded.value = !expanded.value;
}

/** 更多审批选项菜单开关 */
const moreOpen = ref(false);

/** 确认决策响应（Codex 风格多选项：允许一次/本会话/总是/拒绝/换方案） */
function respond(decision: ConfirmDecision): void {
  moreOpen.value = false;
  store.respondConfirm(props.event.id, decision);
}

/** 工具 → 行首灰色线性图标（运行中替换为转圈） */
const TOOL_ICON: Record<string, string> = {
  read_file: 'i-lucide:file-text',
  list_dir: 'i-lucide:folder',
  search: 'i-lucide:search',
  run_command: 'i-lucide:terminal',
  write_file: 'i-lucide:pencil',
  edit_file: 'i-lucide:pencil',
  browse: 'i-lucide:globe'
};

/** 右侧状态图标（done 不显示、running 由行首转圈表达，与图片风格一致） */
const STATUS_ICONS: Partial<Record<AgentToolEvent['status'], string>> = {
  error: 'i-lucide:x',
  confirming: 'i-lucide:clock',
  denied: 'i-lucide:ban'
};

const STATUS_CLS: Partial<Record<AgentToolEvent['status'], string>> = {
  error: 'text-diff-del',
  confirming: 'text-warning',
  denied: 'text-faint'
};

const statusIcon = computed(() => STATUS_ICONS[props.event.status] ?? '');
const statusCls = computed(() => STATUS_CLS[props.event.status] ?? '');

/** 行首图标：运行中转圈，错误态染红，其余灰色工具图标 */
const leadingIcon = computed(() => {
  if (props.event.status === 'running') return 'i-lucide:loader-circle ds-spin text-muted';
  const icon = TOOL_ICON[props.event.name] ?? 'i-lucide:circle';
  return `${icon} ${props.event.status === 'error' ? 'text-diff-del' : 'text-faint'}`;
});

/** 动词文案：写/编辑按状态用「写入中/已写入」等（与图片文案一致），其余工具用通用动词 */
const verb = computed(() => {
  const name = props.event.name;
  if (name === 'write_file') {
    if (props.event.status === 'running') return t('agent.action.writing');
    if (props.event.status === 'done') return t('agent.action.written');
  }
  if (name === 'edit_file') {
    if (props.event.status === 'running') return t('agent.action.editing');
    if (props.event.status === 'done') return t('agent.action.edited');
  }
  return t('agent.verb.' + name);
});

/** 常见扩展名 → 主题强调色 key（tokens.toolAccent），其余按哈希稳定落到同一色板 */
const EXT_COLORS: Record<string, string> = {
  ts: 'tool-read',
  tsx: 'tool-read',
  mts: 'tool-read',
  cts: 'tool-read',
  js: 'tool-search',
  jsx: 'tool-search',
  mjs: 'tool-search',
  cjs: 'tool-search',
  vue: 'tool-write',
  md: 'tool-run',
  json: 'tool-edit',
  css: 'tool-browse',
  scss: 'tool-browse',
  less: 'tool-browse',
  html: 'tool-list',
  py: 'tool-write',
  sh: 'tool-edit'
};

const ACCENT_KEYS = ['tool-read', 'tool-list', 'tool-search', 'tool-run', 'tool-write', 'tool-edit', 'tool-browse'];

function extColor(ext: string): string {
  const key = EXT_COLORS[ext];
  if (key) return key;
  let h = 0;
  for (const ch of ext) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ACCENT_KEYS[Math.abs(h) % ACCENT_KEYS.length] ?? 'tool-read';
}

const PRIMARY_ARG: Record<string, string> = {
  read_file: 'path',
  write_file: 'path',
  edit_file: 'path',
  run_command: 'command',
  search: 'query',
  list_dir: 'path',
  browse: 'url'
};

const primaryValue = computed(() => {
  const key = PRIMARY_ARG[props.event.name];
  try {
    const parsed = JSON.parse(props.event.args) as Record<string, unknown>;
    if (key && parsed[key] !== undefined && parsed[key] !== null) {
      const v = parsed[key];
      return typeof v === 'string' ? v : JSON.stringify(v);
    }
    const kv = Object.entries(parsed)
      .map(([k, v]) => k + '=' + (typeof v === 'string' ? v : JSON.stringify(v)))
      .join(' ');
    return kv || '(默认)';
  } catch {
    return props.event.args;
  }
});

/** 渲染为「文件名 + 目录 + 扩展名徽章」的文件工具 */
const FILE_SPLIT_TOOLS = new Set(['read_file', 'write_file', 'edit_file']);

/** 文件工具的主参数（路径）拆分为 文件名 / 目录 / 大写扩展名 */
const fileSplit = computed(() => {
  if (!FILE_SPLIT_TOOLS.has(props.event.name)) return null;
  // 目录展示完整相对路径（不带项目名）；模型偶尔传绝对路径，去掉工作目录前缀
  const wd = settingsStore.settings.workingDirectory.replace(/[\\/]+$/, '');
  const p = primaryValue.value;
  const rel = wd.length > 0 && p.startsWith(wd + '/') ? p.slice(wd.length + 1) : p;
  const idx = rel.lastIndexOf('/');
  const base = idx >= 0 ? rel.slice(idx + 1) : rel;
  const dir = idx >= 0 ? rel.slice(0, idx + 1) : '';
  // 无扩展名与点文件（.gitignore 等）不显示徽章
  let ext = '';
  if (!base.startsWith('.')) {
    const dot = base.lastIndexOf('.');
    if (dot > 0 && dot < base.length - 1) {
      ext = base.slice(dot + 1);
      if (!/^[a-zA-Z0-9]+$/.test(ext)) ext = '';
    }
  }
  return { base, dir, rel, ext: ext.toUpperCase() };
});

/** 扩展名徽章样式：按文件类型取强调色（文字 + 同色细描边），无扩展名时不渲染 */
const badgeStyle = computed(() => {
  const key = fileSplit.value?.ext ? extColor(fileSplit.value.ext.toLowerCase()) : 'tool-read';
  const c = 'rgb(var(--v-theme-' + key + '))';
  return { color: c, borderColor: c };
});

const prettyArgs = computed(() => {
  try {
    return JSON.stringify(JSON.parse(props.event.args), null, 2);
  } catch {
    return props.event.args;
  }
});

const DIFF_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'list_dir']);

/** 匹配到的文件 diff（写/编辑后主进程推送），用于 +N/-M 与展开的 diff 正文 */
const fileDiff = computed(() => {
  if (!DIFF_TOOLS.has(props.event.name)) return null;
  const p = primaryValue.value;
  // diff 路径为工作目录相对路径；模型传绝对路径时用去前缀后的相对路径兜底匹配
  return store.diffFiles.find(f => f.path === p) ?? store.diffFiles.find(f => f.path === fileSplit.value?.rel) ?? null;
});
</script>

<template>
  <div class="mb-2">
    <!-- 主行：灰色工具图标 + 动词 + 扩展名徽章 + 文件名 + 目录 + 行数 + 状态（仅右侧箭头可展开/折叠） -->
    <div class="group flex items-center gap-1.5 text-sm">
      <span class="shrink-0 text-4" :class="leadingIcon" />
      <span
        class="shrink-0 cursor-pointer text-[13px]"
        :class="event.status === 'error' ? 'text-diff-del' : 'text-muted'"
        @click="toggle"
      >
        {{ verb }}
      </span>
      <span
        v-if="fileSplit?.ext"
        class="shrink-0 rounded border px-1 py-0.5 text-[10px] font-medium leading-none"
        :style="badgeStyle"
      >
        {{ fileSplit.ext }}
      </span>
      <span v-if="fileSplit" class="shrink-0 cursor-pointer font-mono text-[13px] text-fg" @click="toggle">
        {{ fileSplit.base }}
      </span>
      <span v-if="fileSplit?.dir" class="shrink-0 cursor-pointer font-mono text-xs text-muted" @click="toggle">
        {{ fileSplit.dir }}
      </span>
      <span
        v-else-if="!fileSplit"
        class="min-w-0 flex-1 cursor-pointer truncate font-mono text-sm text-fg"
        @click="toggle"
      >
        {{ primaryValue }}
      </span>
      <span v-if="fileDiff" class="shrink-0 font-mono text-xs">
        <span v-if="fileDiff.additions > 0" class="text-diff-add">+{{ fileDiff.additions }}</span>
        <span v-if="fileDiff.deletions > 0" class="ml-1.5 text-diff-del">-{{ fileDiff.deletions }}</span>
      </span>
      <span v-if="statusIcon" class="shrink-0 text-3.5" :class="[statusIcon, statusCls]" />
      <span
        class="shrink-0 cursor-pointer text-3.5 text-faint transition-opacity"
        :class="[
          expanded ? 'i-lucide:chevron-up opacity-100' : 'i-lucide:chevron-down opacity-0 group-hover:opacity-100'
        ]"
        @click="toggle"
      />
    </div>

    <!-- 待确认：Codex 风格多选项（允许一次/拒绝 + 更多：本会话/总是/换方案） -->
    <div v-if="event.status === 'confirming'" class="mt-1.5 flex flex-wrap items-center gap-1.5">
      <VBtn size="x-small" color="primary" prepend-icon="i-lucide:check" @click="respond({ kind: 'allow-once' })">
        {{ t('agent.approveOnce') }}
      </VBtn>
      <VBtn size="x-small" variant="outlined" prepend-icon="i-lucide:x" @click="respond({ kind: 'deny' })">
        {{ t('agent.deny') }}
      </VBtn>
      <VMenu v-model="moreOpen" location="bottom start" :offset="6">
        <template #activator="{ props: menuProps }">
          <VBtn v-bind="menuProps" size="x-small" variant="text" icon="i-lucide:chevron-down" />
        </template>
        <VCard min-width="320" rounded="12px">
          <VList nav density="compact" prepend-gap="10">
            <VListItem
              :title="t('agent.approveSession')"
              :subtitle="t('agent.approveSessionHint')"
              prepend-icon="i-lucide:clock"
              @click="respond({ kind: 'allow-session' })"
            />
            <VListItem
              :title="t('agent.approveAlways')"
              :subtitle="t('agent.neverAsk') + '：' + primaryValue"
              prepend-icon="i-lucide:bookmark"
              @click="respond({ kind: 'allow-always' })"
            />
            <VListItem
              :title="t('agent.denyAndRedo')"
              :subtitle="t('agent.denyAndRedoHint')"
              prepend-icon="i-lucide:rotate-ccw"
              @click="respond({ kind: 'cancel' })"
            />
          </VList>
        </VCard>
      </VMenu>
    </div>

    <!-- 展开：文件工具显示 diff，其余显示参数/结果 -->
    <div v-if="expanded" class="mt-1.5 border-l border-line pl-2.5">
      <div v-if="fileDiff" class="font-mono text-xs leading-[22px]">
        <template v-for="(line, i) in fileDiff.lines" :key="i">
          <div v-if="line.type === 'hunk'" class="text-faint select-none">{{ line.content }}</div>
          <div
            v-else
            class="flex"
            :class="{ 'bg-diff-add/12': line.type === 'add', 'bg-diff-del/12': line.type === 'del' }"
          >
            <span class="w-9 shrink-0 select-none pr-2 text-right text-faint">{{ line.oldLineNo ?? '' }}</span>
            <span class="w-9 shrink-0 select-none pr-2 text-right text-faint">{{ line.newLineNo ?? '' }}</span>
            <span
              class="w-4 shrink-0 select-none text-center"
              :class="{
                'text-diff-add': line.type === 'add',
                'text-diff-del': line.type === 'del',
                'text-faint': line.type === 'context'
              }"
            >
              {{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : '' }}
            </span>
            <span class="whitespace-pre-wrap pr-3 text-fg">{{ line.content }}</span>
          </div>
        </template>
      </div>
      <template v-else>
        <div class="mb-1 text-[11px] text-faint">{{ t('agent.args') }}</div>
        <pre class="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg">{{
          prettyArgs
        }}</pre>
        <template v-if="event.summary || event.error">
          <div class="mt-2 mb-1 text-[11px] text-faint">{{ t('agent.result') }}</div>
          <pre class="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-fg">{{
            event.error ?? event.summary
          }}</pre>
        </template>
      </template>
    </div>
  </div>
</template>
