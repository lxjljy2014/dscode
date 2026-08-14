import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AppSettings, SettingsPatch } from '@dscode/shared';
import { host } from '../bridge/host';
import type { HostApi } from '../bridge/host';

/**
 * 应用设置（工作目录 / 权限模式 / AI 供应商 / 引导状态），主进程 settings.json 持久化。
 * 依赖宿主桥接（host），仅在宿主环境内运行。
 */

const DEFAULTS: AppSettings = {
  workingDirectory: '',
  permissionMode: 'confirm',
  providers: [],
  onboardingDone: false,
  commands: [],
  memory: [],
  skills: [],
  hooks: [],
  subagents: [],
  mcpServers: [],
  browsingEnabled: true,
  approvalRules: []
};

/** 应用只在宿主内运行，桥接缺失视为环境错误 */
function requireHost(): HostApi {
  if (!host) throw new Error('DSCode 宿主桥接不可用');
  return host;
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...DEFAULTS });
  const loaded = ref(false);

  // in-flight 去重：App.vue 与路由守卫会并发触发 load
  let loadPromise: Promise<void> | null = null;

  async function load(): Promise<void> {
    if (loaded.value) return;
    if (!loadPromise) {
      loadPromise = (async () => {
        settings.value = await requireHost().getSettings();
        loaded.value = true;
      })();
    }
    await loadPromise;
  }

  // save 串行化：快速连续切换权限模式/工作目录时按提交顺序落盘，避免响应乱序覆盖 settings.value
  let saveChain: Promise<void> = Promise.resolve();
  function save(patch: SettingsPatch): Promise<void> {
    saveChain = saveChain.then(async () => {
      settings.value = await requireHost().setSettings(patch);
    });
    return saveChain;
  }

  return { settings, loaded, load, save };
});
