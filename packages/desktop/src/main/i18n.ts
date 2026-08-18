import { app } from 'electron';

/**
 * 主进程原生 UI 文案（托盘菜单 / 关于对话框 / 更新提示 / 原生文件对话框）。
 * 原生控件跟随系统语言（app.getLocale），渲染层语言切换不影响这些原生界面。
 */

function isZh(): boolean {
  return app.getLocale().toLowerCase().startsWith('zh');
}

export interface MainLabels {
  settingsSections: ReadonlyArray<{ section: string; label: string }>;
  noRecentProjects: string;
  openDscode: string;
  newSession: string;
  recentProjects: string;
  settings: string;
  checkUpdates: string;
  aboutDscode: string;
  quit: string;
  about: { title: string; subtitle: string; version: string; copyright: string; ok: string };
  updater: { checkTitle: string; latest: string; currentVersion: string; failTitle: string; failMessage: string; ok: string };
  dialogs: { pickDirectory: string; pickFiles: string; saveFile: string };
}

const ZH: MainLabels = {
  settingsSections: [
    { section: 'general', label: '通用' },
    { section: 'appearance', label: '外观' },
    { section: 'model', label: '模型' },
    { section: 'memory', label: '记忆' },
    { section: 'skills', label: '技能' },
    { section: 'usage', label: '使用统计' }
  ],
  noRecentProjects: '（无最近项目）',
  openDscode: '打开 DSCode',
  newSession: '新建会话',
  recentProjects: '最近项目',
  settings: '设置',
  checkUpdates: '检查更新',
  aboutDscode: '关于 DSCode',
  quit: '退出',
  about: { title: '关于 DSCode', subtitle: 'AI 编程助手桌面客户端', version: '版本', copyright: 'Copyright © 2026 DSCode', ok: '确定' },
  updater: { checkTitle: '检查更新', latest: '已是最新版本', currentVersion: '当前版本', failTitle: '检查更新失败', failMessage: '无法完成自动更新', ok: '确定' },
  dialogs: { pickDirectory: '选择工作目录', pickFiles: '选择文件', saveFile: '保存文件' }
};

const EN: MainLabels = {
  settingsSections: [
    { section: 'general', label: 'General' },
    { section: 'appearance', label: 'Appearance' },
    { section: 'model', label: 'Model' },
    { section: 'memory', label: 'Memory' },
    { section: 'skills', label: 'Skills' },
    { section: 'usage', label: 'Usage' }
  ],
  noRecentProjects: '(no recent projects)',
  openDscode: 'Open DSCode',
  newSession: 'New session',
  recentProjects: 'Recent projects',
  settings: 'Settings',
  checkUpdates: 'Check for updates',
  aboutDscode: 'About DSCode',
  quit: 'Quit',
  about: { title: 'About DSCode', subtitle: 'AI coding assistant desktop client', version: 'Version', copyright: 'Copyright © 2026 DSCode', ok: 'OK' },
  updater: { checkTitle: 'Check for updates', latest: 'You are up to date', currentVersion: 'Current version', failTitle: 'Update check failed', failMessage: 'Unable to complete the update check', ok: 'OK' },
  dialogs: { pickDirectory: 'Select working directory', pickFiles: 'Select files', saveFile: 'Save file' }
};

export function mainLabels(): MainLabels {
  return isZh() ? ZH : EN;
}
