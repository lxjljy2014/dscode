<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalExitInfo } from '@dscode/shared';
import { host } from '../../bridge/host';
import { useUiStore } from '../../stores/ui';
import { useSettingsStore } from '../../stores/settings';
import { fontFamilyMono } from '../../theme/tokens';
import { buildXtermTheme } from '../../utils/xterm-theme';
import ResizeHandle from '../common/ResizeHandle.vue';

const { t } = useI18n();
const uiStore = useUiStore();
const settingsStore = useSettingsStore();

/** 面板高度限制（px） */
const TERMINAL_MIN_HEIGHT = 200;
const TERMINAL_MAX_HEIGHT = 500;

/** 终端标签页状态（会话由主进程按 sessionId 管理） */
interface TabState {
  id: string;
  title: string;
  exited: TerminalExitInfo | null;
  ensureError: string;
}

/** 单个会话的渲染视图（xterm 实例 + 订阅 + 尺寸观察） */
interface ViewState {
  term: Terminal;
  fit: FitAddon;
  ro: ResizeObserver;
  disposers: Array<() => void>;
}

const tabs = ref<TabState[]>([]);
const activeId = ref('');
let tabSeq = 0;

const containers = new Map<string, HTMLElement>();
const views = new Map<string, ViewState>();
/** 组件级订阅（按 sessionId 分发），应用退出时统一清理 */
const unsubscribers: Array<() => void> = [];

const activeTab = computed(() => tabs.value.find(x => x.id === activeId.value) ?? null);
const activeError = computed(() => activeTab.value?.ensureError ?? '');

// ---- 视图生命周期 ----

function setContainer(id: string, el: unknown): void {
  if (el instanceof HTMLElement) containers.set(id, el);
  else containers.delete(id);
}

/** 为标签页建立 xterm 视图 + 主进程会话（幂等） */
async function initTab(tab: TabState): Promise<void> {
  if (!host || views.has(tab.id)) return;
  const container = containers.get(tab.id);
  if (!container) return;

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: fontFamilyMono,
    fontSize: 13,
    lineHeight: 1.2,
    // xterm 6 用 overviewRuler.width 控制自绘滚动条宽度（默认 14px，收窄为 8px）
    overviewRuler: { width: 8 },
    theme: buildXtermTheme(uiStore.theme === 'dark')
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);
  fit.fit();

  const dataDisposable = term.onData(data => host?.terminalWrite(tab.id, data));
  const resizeDisposable = term.onResize(({ cols, rows }) => host?.terminalResize(tab.id, cols, rows));
  const ro = new ResizeObserver(() => {
    // v-show 隐藏时容器尺寸为 0，跳过 fit，避免误测行/列并向 pty 发错误尺寸
    if (container.clientWidth > 0 && container.clientHeight > 0) fit.fit();
  });
  ro.observe(container);
  views.set(tab.id, {
    term,
    fit,
    ro,
    disposers: [() => dataDisposable.dispose(), () => resizeDisposable.dispose()]
  });

  const cwd = settingsStore.settings.workingDirectory || '';
  let ensureResult: { ok: boolean; error?: string };
  try {
    ensureResult = await host.terminalEnsure(tab.id, cwd);
  } catch {
    // 传输级异常：归为启动失败，避免 unhandled rejection
    ensureResult = { ok: false, error: t('terminal.ensureFailed') };
  }
  // 初始化期间标签可能已被关闭：刚创建的会话已无主，回收避免孤儿 pty
  if (!views.has(tab.id)) {
    void host.terminalKill(tab.id);
    return;
  }
  if (!ensureResult.ok) tab.ensureError = ensureResult.error ?? '';
}

/** 回收标签页的 xterm 视图与会话 */
function disposeTab(id: string): void {
  const view = views.get(id);
  if (view) {
    view.ro.disconnect();
    for (const off of view.disposers) off();
    view.term.dispose();
    views.delete(id);
  }
  void host?.terminalKill(id);
}

function createTab(): void {
  const tab: TabState = {
    id: crypto.randomUUID(),
    title: t('terminal.tabTitle', { n: ++tabSeq }),
    exited: null,
    ensureError: ''
  };
  tabs.value.push(tab);
  activeId.value = tab.id;
  void nextTick().then(() => void initTab(tab));
}

/** 标签切换（VTab 点击）：v-model 事件里只接受字符串值 */
function onTabChange(v: unknown): void {
  if (typeof v === 'string') activeId.value = v;
}

function closeTab(id: string): void {
  disposeTab(id);
  const i = tabs.value.findIndex(x => x.id === id);
  if (i < 0) return;
  tabs.value.splice(i, 1);
  if (activeId.value === id) {
    const next = tabs.value[Math.min(i, tabs.value.length - 1)];
    activeId.value = next?.id ?? '';
  }
  // 关闭最后一个标签时收起面板，重开会自动新建
  if (tabs.value.length === 0) uiStore.terminalVisible = false;
}

/** 关闭当前激活的终端标签 */
function closeActive(): void {
  const id = activeId.value;
  if (id) closeTab(id);
}

function fitActive(): void {
  const id = activeId.value;
  if (id) views.get(id)?.fit.fit();
}

// 标签切换（点击或关闭后重选）时重新适配尺寸
watch(activeId, () => void nextTick().then(fitActive));

// ---- 面板开关 ----

// 面板打开时若尚无标签则新建；内容用 v-show 常驻渲染，隐藏期间会话保持存活
watch(
  () => uiStore.terminalVisible,
  async visible => {
    if (!visible) return;
    if (tabs.value.length === 0) createTab();
    else {
      await nextTick();
      fitActive();
    }
  },
  { immediate: true }
);

// ---- 主进程事件（按 sessionId 分发） ----

onMounted(() => {
  if (!host) return;
  unsubscribers.push(
    host.onTerminalData(ev => views.get(ev.sessionId)?.term.write(ev.data)),
    host.onTerminalExit(info => {
      const tab = tabs.value.find(x => x.id === info.sessionId);
      if (tab) tab.exited = info;
    })
  );
});

// 主题切换热更新全部 xterm 配色
watch(
  () => uiStore.theme,
  mode => {
    const theme = buildXtermTheme(mode === 'dark');
    for (const view of views.values()) view.term.options.theme = theme;
  }
);

// 应用退出等场景兜底回收
onBeforeUnmount(() => {
  for (const off of unsubscribers.splice(0)) off();
  for (const id of views.keys()) disposeTab(id); // disposeTab 只删当前项，Map 迭代中删除安全
});
</script>

<template>
  <VNavigationDrawer
    v-model="uiStore.terminalVisible"
    :permanent="uiStore.terminalVisible"
    color="background"
    location="bottom"
    :width="uiStore.terminalHeight"
  >
    <!-- v-show 常驻渲染：隐藏面板不杀会话，标签页状态保留 -->
    <!-- 不加 relative：句柄定位上下文直接是抽屉根元素，细线贴到顶缘与边框重合 -->
    <div v-show="uiStore.terminalVisible" class="flex h-full flex-col">
      <!-- 顶部拖拽条：调整面板高度 -->
      <ResizeHandle
        axis="y"
        :size="uiStore.terminalHeight"
        :min="TERMINAL_MIN_HEIGHT"
        :max="TERMINAL_MAX_HEIGHT"
        @resize="uiStore.setTerminalHeight"
      />
      <!-- 标签栏：VToolbar（图标/新增按钮/状态）+ VTabs 可关闭标签 -->
      <VToolbar density="compact" color="transparent" class="border-b border-line">
        <template #prepend>
          <VIcon icon="i-lucide:square-terminal" size="14" class="text-muted" />
        </template>
        <!-- 关闭滚动到激活标签：标签通常不溢出，且面板隐藏/尺寸变化会中断滚动动画 -->
        <!-- （避免 Vuetify 报 "Scroll target is not reachable" 刷屏） -->
        <VTabs
          :model-value="activeId"
          :scroll-to-active="false"
          density="compact"
          class="min-w-0 flex-1"
          @update:model-value="onTabChange"
        >
          <VTab v-for="tab in tabs" :key="tab.id" :value="tab.id" class="text-muted">
            {{ tab.title }}
          </VTab>
        </VTabs>
        <template #append>
          <span v-if="activeTab?.exited" class="me-1 text-xs text-diff-del">
            {{ t('terminal.exited', { code: activeTab.exited.exitCode }) }}
          </span>
          <span v-else-if="activeError" class="me-1 text-xs text-diff-del">{{ activeError }}</span>
          <span v-else-if="host" class="me-1 text-xs text-faint">{{ t('terminal.running') }}</span>
          <VTooltip :text="t('terminal.close')" location="top">
            <template #activator="{ props: closeProps }">
              <VBtn
                v-bind="closeProps"
                icon="i-lucide:x"
                size="x-small"
                variant="text"
                class="text-muted"
                :disabled="!activeTab"
                @click="closeActive"
              />
            </template>
          </VTooltip>
          <VTooltip :text="t('terminal.add')" location="top">
            <template #activator="{ props: tipProps }">
              <VBtn
                v-bind="tipProps"
                icon="i-lucide:plus"
                size="x-small"
                variant="text"
                class="text-muted"
                @click="createTab"
              />
            </template>
          </VTooltip>
        </template>
      </VToolbar>

      <!-- 纯浏览器降级 -->
      <div v-if="!host" class="flex flex-1 items-center justify-center p-4 text-sm text-muted">
        {{ t('terminal.placeholder') }}
      </div>
      <!-- 终端区：背景取 surface，与抽屉底色融合 -->
      <div v-else class="relative min-h-0 flex-1 pa-2">
        <div
          v-for="tab in tabs"
          v-show="tab.id === activeId"
          :key="tab.id"
          :ref="el => setContainer(tab.id, el)"
          class="h-full w-full"
        />
        <!-- 会话创建失败时覆盖提示 -->
        <div
          v-if="activeError"
          class="absolute inset-0 flex items-center justify-center bg-surface p-4 text-sm text-diff-del"
        >
          {{ activeError }}
        </div>
      </div>
    </div>
  </VNavigationDrawer>
</template>
