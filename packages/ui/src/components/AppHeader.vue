<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { isFrameless, isMac } from '../host'
import { supportedLocales } from '../plugins/i18n'
import { useUiStore } from '../stores/ui'
import { useSessionStore } from '../stores/session'
import {computed} from "vue";

const { t } = useI18n()
const ui = useUiStore()
const sessionStore = useSessionStore()

const messages = computed(() => sessionStore.activeSession?.messages ?? [])

// 平台布局差异（仅预留位置，控件由系统绘制）：
// macOS：红绿灯悬浮在左上角 —— 左侧栏展开时落在侧栏顶部让位区，header 无需预留；
//        侧栏隐藏时 header 顶到窗口左缘，需左 padding 84px 让位
// Windows：原生悬浮按钮叠在 header 右侧 → 右 padding 约 138px
const hasOverlayControls = isFrameless && !isMac
</script>

<template>
  <v-app-bar
    density="compact"
    color="background"
    class="px-2"
    :class="{
    'ds-drag': isFrameless,
    'pl-[84px]': isMac && !ui.leftVisible,
    'pr-[138px]': hasOverlayControls,
    'border-b border-line': messages.length
    }"
  >
    <!-- 左侧栏切换平时在侧栏顶栏；侧栏隐藏时回到 header（macOS 下左 padding 已让位红绿灯） -->
    <v-tooltip v-if="!ui.leftVisible" :text="t('settings.toggleLeft')" location="bottom">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          icon="i-lucide:panel-left-open"
          variant="text"
          size="small"
          class="text-muted"
          @click="ui.toggleLeft()"
        />
      </template>
    </v-tooltip>
    <v-spacer />
    <div class="flex items-center gap-1">
      <v-icon-btn
          v-tooltip="{text: t('settings.terminal'), location: 'bottom'}"
          icon="i-lucide:square-terminal"
          variant="text"
          size="small"
          density="comfortable"
          class="text-muted"
          @click="ui.toggleTerminal()"
      />

      <v-icon-btn
          v-if="messages.length"
          v-tooltip="{text: t('settings.toggleRight'), location: 'bottom'}"
          :icon="ui.rightVisible ? 'i-lucide:panel-right-close' : 'i-lucide:panel-left-close'"
          variant="text"
          size="small"
          rounded="lg"
          class="text-muted"
          @click="ui.toggleRight()"
      />
    </div>
  </v-app-bar>
</template>
