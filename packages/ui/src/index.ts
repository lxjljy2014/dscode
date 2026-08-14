// @dscode/ui 统一出口：客户端无关的前端层（页面 / 组件 / stores / 宿主桥接 / 插件）。
// 桌面端经本出口组装；将来 web 端同样经本出口复用。TerminalPanel 等仅包内使用的组件不在此导出。

export { createVuetifyPlugin } from './plugins/vuetify';
export { createI18nPlugin, supportedLocales, vuetifyLocaleMap } from './plugins/i18n';
export type { AppLocale } from './plugins/i18n';

export { host, isFrameless, isMac, TITLEBAR_OVERLAY_WIDTH } from './bridge/host';
export type { HostApi, TitleBarOverlayOptions } from './bridge/host';

export { useUiStore } from './stores/ui';
export type { LocaleSetting, ThemeMode } from './stores/ui';
export { useSessionStore } from './stores/session';
export { useSettingsStore } from './stores/settings';

// 页面
export { default as WorkspaceView } from './pages/WorkspaceView.vue';
export { default as OnboardingView } from './pages/OnboardingView.vue';
export { default as SettingsView } from './pages/settings/SettingsView.vue';
export { default as SettingsSidebar } from './pages/settings/SettingsSidebar.vue';
export { default as SettingsHeader } from './pages/settings/SettingsHeader.vue';
export { default as SettingsGeneral } from './pages/settings/SettingsGeneral.vue';
export { default as SettingsProviders } from './pages/settings/SettingsProviders.vue';
export { default as SettingsPlaceholder } from './pages/settings/SettingsPlaceholder.vue';

// 按域组件
export { default as ChatView } from './components/chat/ChatView.vue';
export { default as MessageItem } from './components/chat/MessageItem.vue';
export { default as ChatInput } from './components/chat/ChatInput.vue';
export { default as AppHeader } from './components/workspace/AppHeader.vue';
export { default as SessionSidebar } from './components/workspace/SessionSidebar.vue';
export { default as WorkspaceSidebar } from './components/workspace/WorkspaceSidebar.vue';
export { default as WorkspacePanel } from './components/workspace/WorkspacePanel.vue';
export { default as DiffPanel } from './components/workspace/DiffPanel.vue';
export { default as FileTree } from './components/workspace/FileTree.vue';
export { default as GitBranchMenu } from './components/git/GitBranchMenu.vue';
export { default as UserBar } from './components/common/UserBar.vue';
export { default as ResizeHandle } from './components/common/ResizeHandle.vue';
