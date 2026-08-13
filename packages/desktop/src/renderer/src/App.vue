<script setup lang="ts">
import { watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLocale, useTheme } from 'vuetify';
import { host, useSettingsStore, useUiStore, vuetifyLocaleMap } from '@dscode/ui';
import { darkTheme, lightTheme } from '@dscode/ui/tokens';

const ui = useUiStore();
const settingsStore = useSettingsStore();
const theme = useTheme();
const { locale } = useI18n();
const { current } = useLocale();

// 启动时加载应用设置（工作目录 / 权限模式）
void settingsStore.load();

// 主题：store → Vuetify + color-scheme + Windows 标题栏悬浮按钮符号色
watchEffect(() => {
  theme.change(ui.theme);
  document.documentElement.style.colorScheme = ui.theme;
  const colors = ui.theme === 'dark' ? darkTheme.colors : lightTheme.colors;
  if (host && colors) {
    host.setTitleBarOverlay({
      symbolColor: colors['on-surface'] as string
    });
  }
});

// 语言：store → vue-i18n + Vuetify locale（system 时按操作系统解析）
watch(
  () => ui.resolvedLocale,
  value => {
    locale.value = value;
    current.value = vuetifyLocaleMap[value];
    document.documentElement.lang = value;
  },
  { immediate: true }
);
</script>

<template>
  <!-- 仅提供最外层 v-app，布局由各路由页面自行声明 -->
  <VApp>
    <RouterView />
  </VApp>
</template>
