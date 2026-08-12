<script setup lang="ts">
import { watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocale, useTheme } from 'vuetify'
import { host, useUiStore, vuetifyLocaleMap } from '@dscode/ui'
import { darkTheme, lightTheme } from '@dscode/ui/tokens'

const ui = useUiStore()
const theme = useTheme()
const { locale } = useI18n()
const { current } = useLocale()

// 主题：store → Vuetify + color-scheme + Windows 标题栏悬浮按钮配色
watchEffect(() => {
  theme.global.name.value = ui.theme
  document.documentElement.style.colorScheme = ui.theme
  const colors = ui.theme === 'dark' ? darkTheme.colors : lightTheme.colors
  if (host && colors) {
    host.setTitleBarOverlay({
      color: colors.surface as string,
      symbolColor: colors['on-surface'] as string
    })
  }
})

// 语言：store → vue-i18n + Vuetify locale（system 时按操作系统解析）
watch(
  () => ui.resolvedLocale,
  value => {
    locale.value = value
    current.value = vuetifyLocaleMap[value]
  },
  { immediate: true }
)
</script>

<template>
  <!-- 仅提供最外层 v-app，布局由各路由页面自行声明 -->
  <v-app>
    <router-view />
  </v-app>
</template>
