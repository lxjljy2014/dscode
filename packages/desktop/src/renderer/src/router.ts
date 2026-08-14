import { createRouter, createWebHashHistory } from 'vue-router';
import {
  OnboardingView,
  SettingsAppearance,
  SettingsBrowser,
  SettingsCommands,
  SettingsGeneral,
  SettingsHooks,
  SettingsIndex,
  SettingsMcp,
  SettingsMemory,
  SettingsModel,
  SettingsPlugins,
  SettingsSkills,
  SettingsSubagents,
  SettingsUsage,
  SettingsPlaceholder,
  SettingsProviders,
  SettingsView,
  useSettingsStore,
  WorkspaceView
} from '@dscode/ui';

/**
 * 每个路由都是独立完整页面，仅共享最外层 v-app：
 * - `/`：工作区（会话侧栏 + 顶栏 + diff 抽屉 + 聊天区）
 * - `/onboarding`：首次启动引导页（填写 AI 供应商 API key，可跳过）
 * - `/settings/:section`：设置页（设置导航侧栏 + 设置顶栏 + 版块内容）
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'workspace', component: WorkspaceView },
    { path: '/onboarding', name: 'onboarding', component: OnboardingView },
    {
      path: '/settings',
      component: SettingsView,
      children: [
        { path: '', redirect: '/settings/general' },
        { path: 'general', name: 'settings-general', component: SettingsGeneral },
        { path: 'appearance', name: 'settings-appearance', component: SettingsAppearance },
        { path: 'model', name: 'settings-model', component: SettingsModel },
        { path: 'commands', name: 'settings-commands', component: SettingsCommands },
        { path: 'memory', name: 'settings-memory', component: SettingsMemory },
        { path: 'skills', name: 'settings-skills', component: SettingsSkills },
        { path: 'hooks', name: 'settings-hooks', component: SettingsHooks },
        { path: 'usage', name: 'settings-usage', component: SettingsUsage },
        { path: 'subagents', name: 'settings-subagents', component: SettingsSubagents },
        { path: 'mcp', name: 'settings-mcp', component: SettingsMcp },
        { path: 'plugins', name: 'settings-plugins', component: SettingsPlugins },
        { path: 'index', name: 'settings-index', component: SettingsIndex },
        { path: 'browser', name: 'settings-browser', component: SettingsBrowser },
        // 自定义参数正则：只匹配字面量 'onboarding'，同时保留 :section 参数，
        // 让 SettingsView 标题与侧栏高亮无需为静态子路由特判
        { path: ':section(onboarding)', name: 'settings-onboarding', component: SettingsProviders },
        // 其余版块统一走占位页
        { path: ':section', name: 'settings-section', component: SettingsPlaceholder }
      ]
    }
  ]
});

// 首次启动守卫：未完成引导（未填写/跳过 API key）时一律先进引导页。
// useSettingsStore 在守卫内调用（main.ts 中 pinia 先于 router 安装，时序安全）。
router.beforeEach(async to => {
  if (to.name === 'onboarding') return true;
  const settings = useSettingsStore();
  await settings.load();
  if (!settings.settings.onboardingDone) return { name: 'onboarding' };
  return true;
});
