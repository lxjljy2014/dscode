<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import { isFrameless, isMac, TITLEBAR_OVERLAY_WIDTH } from '../../bridge/host';
import { useUiStore } from '../../stores/ui';
import { useSessionStore } from '../../stores/session';
import { useSettingsStore } from '../../stores/settings';
import GitBranchMenu from '../git/GitBranchMenu.vue';

const { t } = useI18n();
const uiStore = useUiStore();
const sessionStore = useSessionStore();
const settingsStore = useSettingsStore();

const messages = computed(() => sessionStore.activeSession?.messages ?? []);

/** 当前工作空间：只读展示（有消息后工作空间已锁定，切换入口在空会话的输入卡上） */
const currentWorkspace = computed(() => settingsStore.settings.workingDirectory);
const currentWorkspaceName = computed(() => {
  const wd = currentWorkspace.value;
  if (!wd) return '';
  return wd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || wd;
});

// 平台布局差异（仅预留位置，控件由系统绘制）：
// macOS：红绿灯悬浮在左上角 —— 左侧栏展开时落在侧栏顶部让位区，header 无需预留；
//        侧栏隐藏时 header 顶到窗口左缘，需左 padding 84px 让位
// Windows：原生悬浮按钮叠在 header 右侧 → 右 padding 约 150px
const hasOverlayControls = isFrameless && !isMac;
</script>

<template>
  <VAppBar
    density="compact"
    color="background"
    class="px-2"
    :class="{
      'ds-drag': isFrameless,
      'pl-[84px]': isMac && !uiStore.leftVisible,
      'border-b border-line': messages.length
    }"
    :style="hasOverlayControls ? { paddingRight: `${TITLEBAR_OVERLAY_WIDTH}px` } : undefined"
  >
    <!-- 左侧栏切换平时在侧栏顶栏；侧栏隐藏时回到 header（macOS 下左 padding 已让位红绿灯） -->
    <VTooltip v-if="!uiStore.leftVisible" :text="t('settings.toggleLeft')" location="bottom">
      <template #activator="{ props }">
        <VBtn
          v-bind="props"
          icon="i-lucide:panel-left-open"
          variant="text"
          size="small"
          class="text-muted"
          @click="uiStore.toggleLeft()"
        />
      </template>
    </VTooltip>
    <!-- 当前任务名称（与激活会话联动；无标题时显示占位标签） -->
    <span v-if="sessionStore.hasMessage" class="max-w-48 truncate text-xs text-muted">
      {{ sessionStore.activeSession?.title || t('header.taskName') }}
    </span>
    <div v-if="sessionStore.hasMessage" class="flex items-center gap-2 px-2 py-1">
      <!-- 当前工作空间：只读展示（有消息后工作空间已锁定，切换入口在空会话的输入卡） -->
      <VTooltip :text="currentWorkspace || t('input.selectProject')" location="bottom">
        <template #activator="{ props }">
          <div
            v-bind="props"
            class="flex max-w-44 cursor-default items-center gap-1.5 rounded-full bg-elevated px-2.5 py-1 text-xs text-muted"
          >
            <span class="i-lucide:folder shrink-0 text-3.5" />
            <span class="truncate">{{ currentWorkspaceName || t('input.selectProject') }}</span>
          </div>
        </template>
      </VTooltip>
      <!-- git 分支：与输入卡片共用 GitBranchMenu（tonal 样式贴合 header） -->
      <GitBranchMenu tonal />
    </div>
    <VSpacer />
    <div class="flex items-center gap-1">
      <VIconBtn
        v-tooltip="{ text: t('settings.terminal'), location: 'bottom' }"
        icon="i-lucide:square-terminal"
        variant="text"
        size="small"
        density="comfortable"
        class="text-muted"
        @click="uiStore.toggleTerminal()"
      />

      <VIconBtn
        v-if="messages.length"
        v-tooltip="{ text: t('settings.toggleRight'), location: 'bottom' }"
        :icon="uiStore.rightVisible ? 'i-lucide:panel-right-close' : 'i-lucide:panel-right-open'"
        variant="text"
        size="small"
        rounded="lg"
        class="text-muted"
        @click="uiStore.toggleRight()"
      />
    </div>
  </VAppBar>
</template>
