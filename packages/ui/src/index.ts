export { createVuetifyPlugin } from './plugins/vuetify';
export { createI18nPlugin, supportedLocales, vuetifyLocaleMap } from './plugins/i18n';
export type { AppLocale } from './plugins/i18n';

export { host, isFrameless, isMac, TITLEBAR_OVERLAY_WIDTH } from './host';
export type { HostApi, TitleBarOverlayOptions } from './host';

export { useUiStore } from './stores/ui';
export type { LocaleSetting, ThemeMode } from './stores/ui';
export { useSessionStore } from './stores/session';
export { useSettingsStore } from './stores/settings';

export { default as AppHeader } from './components/AppHeader.vue';
export { default as SessionSidebar } from './components/SessionSidebar.vue';
export { default as UserBar } from './components/UserBar.vue';
export { default as WorkspaceSidebar } from './components/WorkspaceSidebar.vue';
export { default as WorkspacePanel } from './components/WorkspacePanel.vue';
export { default as WorkspaceView } from './components/WorkspaceView.vue';
export { default as SettingsSidebar } from './components/SettingsSidebar.vue';
export { default as SettingsView } from './components/SettingsView.vue';
export { default as SettingsHeader } from './components/SettingsHeader.vue';
export { default as SettingsGeneral } from './components/SettingsGeneral.vue';
export { default as SettingsPlaceholder } from './components/SettingsPlaceholder.vue';
export { default as ChatView } from './components/ChatView.vue';
export { default as MessageItem } from './components/MessageItem.vue';
export { default as ChatInput } from './components/ChatInput.vue';
export { default as GitBranchMenu } from './components/GitBranchMenu.vue';
export { default as DiffPanel } from './components/DiffPanel.vue';
export { default as FileTree } from './components/FileTree.vue';
