<script setup lang="ts">
import { watch, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useLocale, useTheme } from 'vuetify';
import type { TrayAction } from '@dscode/shared';
import { host, useSessionStore, useSettingsStore, useUiStore, vuetifyLocaleMap } from '@dscode/ui';
import { darkTheme, lightTheme } from '@dscode/ui/tokens';

const ui = useUiStore();
const settingsStore = useSettingsStore();
const theme = useTheme();
const { locale } = useI18n();
const { current } = useLocale();
const router = useRouter();

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

// 系统托盘菜单动作分发：主进程托盘右键菜单 → 渲染端执行对应动作
// （新建会话 / 切换最近工作空间 / 打开设置版块）
if (host?.onTrayAction) {
  host.onTrayAction((ev: TrayAction) => {
    switch (ev.action) {
      case 'new-session':
        useSessionStore().createSession();
        void router.push('/');
        break;
      case 'open-workspace':
        // 工作目录变化由 settings store 的 wd watcher 驱动会话/文件树刷新
        if (ev.workspace !== settingsStore.settings.workingDirectory) {
          void settingsStore.save({ workingDirectory: ev.workspace });
        }
        void router.push('/');
        break;
      case 'open-settings':
        void router.push(`/settings/${ev.section}`);
        break;
    }
  });
}
</script>

<template>
  <!-- 仅提供最外层 v-app，布局由各路由页面自行声明 -->
  <VApp>
    <RouterView />
  </VApp>
</template>
