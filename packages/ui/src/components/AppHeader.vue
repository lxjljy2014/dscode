<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import { isFrameless, isMac, TITLEBAR_OVERLAY_WIDTH } from '../host';
import { useUiStore } from '../stores/ui';
import { useSessionStore } from '../stores/session';

const { t } = useI18n();
const uiStore = useUiStore();
const sessionStore = useSessionStore();

const messages = computed(() => sessionStore.activeSession?.messages ?? []);

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
    <span v-if="sessionStore.hasMessage" class="text-muted">{{ t('header.taskName') }}</span>
    <div v-if="sessionStore.hasMessage" class="flex gap-2 px-2 py-1">
      <!-- 项目选择条 -->
      <VMenu location="top start" :offset="4">
        <template #activator="{ props: menuProps }">
          <VBtn
            v-bind="!sessionStore.hasMessage ? menuProps : null"
            :variant="sessionStore.hasMessage ? 'tonal' : 'text'"
            :base-color="sessionStore.hasMessage ? 'surface' : ''"
            rounded="pill"
            size="small"
            class="text-muted"
            prepend-icon="i-lucide:folder"
            append-icon="i-lucide:chevron-down"
          >
            {{ t('input.selectProject') }}
          </VBtn>
        </template>
        <VList min-width="200" nav>
          <VListItem active prepend-icon="i-lucide:folder">
            <VListItemTitle class="text-sm">dscode</VListItemTitle>
            <template #append>
              <VIcon icon="i-lucide:check" size="16" />
            </template>
          </VListItem>
        </VList>
      </VMenu>
      <!--      git 分支-->
      <VMenu location="top start" :offset="4">
        <template #activator="{ props: menuProps }">
          <VBtn
            v-bind="menuProps"
            :variant="sessionStore.hasMessage ? 'tonal' : 'text'"
            :base-color="sessionStore.hasMessage ? 'surface' : ''"
            rounded="pill"
            size="small"
            class="text-muted"
            prepend-icon="i-lucide:git-branch"
            append-icon="i-lucide:chevron-down"
          >
            {{ t('input.gitBranch') }}
          </VBtn>
        </template>
        <VList min-width="200" nav>
          <VListItem active prepend-icon="i-lucide:folder">
            <VListItemTitle class="text-sm">dscode</VListItemTitle>
            <template #append>
              <VIcon icon="i-lucide:check" size="16" />
            </template>
          </VListItem>
        </VList>
      </VMenu>
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
