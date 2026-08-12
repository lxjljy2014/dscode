import { createRouter, createWebHashHistory } from 'vue-router'
import {
  SettingsGeneral,
  SettingsPlaceholder,
  SettingsView,
  WorkspaceView
} from '@dscode/ui'

/**
 * 每个路由都是独立完整页面，仅共享最外层 v-app：
 * - `/`：工作区（会话侧栏 + 顶栏 + diff 抽屉 + 聊天区）
 * - `/settings/:section`：设置页（设置导航侧栏 + 设置顶栏 + 版块内容）
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'workspace', component: WorkspaceView },
    {
      path: '/settings',
      component: SettingsView,
      children: [
        { path: '', redirect: '/settings/general' },
        { path: 'general', name: 'settings-general', component: SettingsGeneral },
        // 其余版块统一走占位页
        { path: ':section', name: 'settings-section', component: SettingsPlaceholder }
      ]
    }
  ]
})
