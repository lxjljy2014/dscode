<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { isFrameless, isMac, TITLEBAR_OVERLAY_WIDTH } from '../host'

const { t } = useI18n()

// 与工作区 header 同高（48px），保持跨路由布局稳定；
// macOS 红绿灯落在左侧栏顶部让位区，Windows 预留原生悬浮按钮宽度
const hasOverlayControls = isFrameless && !isMac
</script>

<template>
  <v-app-bar
    density="compact"
    color="background"
    class="pl-2"

    :class="[isFrameless ? 'ds-drag' : '', 'pr-2']"
    :style="hasOverlayControls ? { paddingRight: `${TITLEBAR_OVERLAY_WIDTH}px` } : undefined"
  >
    <v-spacer />

    <v-btn icon="i-lucide:circle-help" variant="text" size="small" class="text-muted" />
    <v-btn variant="outlined" size="small" rounded="pill" class="px-3 text-muted">
      {{ t('settingsPage.help') }}
    </v-btn>
  </v-app-bar>
</template>
