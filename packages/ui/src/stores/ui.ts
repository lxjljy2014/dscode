import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { AppLocale } from '../plugins/i18n';

export type ThemeMode = 'light' | 'dark';
/** 语言设置：system 表示跟随操作系统 */
export type LocaleSetting = AppLocale | 'system';

const STORAGE_KEY = 'dscode.ui';

interface PersistedState {
  theme?: ThemeMode;
  locale?: LocaleSetting;
}

function loadPersisted(): PersistedState {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as PersistedState;
  } catch {
    return {};
  }
}

function systemTheme(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function systemLocale(): AppLocale {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export const useUiStore = defineStore('ui', () => {
  const persisted = loadPersisted();

  const theme = ref<ThemeMode>(persisted.theme ?? systemTheme());
  const locale = ref<LocaleSetting>(persisted.locale ?? 'zh-CN');
  // 侧栏显隐不持久化：每次启动左侧展开、右侧隐藏
  const leftVisible = ref(true);
  const rightVisible = ref(false);
  const terminalVisible = ref(false);
  // 面板尺寸同样不持久化：每次启动恢复默认（终端 280 / 右侧 440），范围限制在各面板组件
  const terminalHeight = ref(280);
  const rightPanelWidth = ref(440);

  /** 实际生效的语言（system 时按操作系统解析） */
  const resolvedLocale = computed<AppLocale>(() => (locale.value === 'system' ? systemLocale() : locale.value));

  watch(
    [theme, locale],
    () => {
      const state: PersistedState = {
        theme: theme.value,
        locale: locale.value
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    },
    { flush: 'post' }
  );

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  }

  function setLocale(value: LocaleSetting) {
    locale.value = value;
  }

  function toggleLeft() {
    leftVisible.value = !leftVisible.value;
  }

  function toggleRight() {
    rightVisible.value = !rightVisible.value;
  }

  function toggleTerminal() {
    terminalVisible.value = !terminalVisible.value;
  }

  function setTerminalHeight(value: number) {
    terminalHeight.value = value;
  }

  function setRightPanelWidth(value: number) {
    rightPanelWidth.value = value;
  }

  return {
    theme,
    locale,
    resolvedLocale,
    leftVisible,
    rightVisible,
    toggleTheme,
    setLocale,
    toggleLeft,
    toggleRight,
    terminalVisible,
    toggleTerminal,
    terminalHeight,
    setTerminalHeight,
    rightPanelWidth,
    setRightPanelWidth
  };
});
