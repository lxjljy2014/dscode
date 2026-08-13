import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AppSettings, ProviderConfig, SettingsPatch } from '@dscode/shared';
import { host } from '../host';

/**
 * 应用设置（工作目录 / 权限模式 / AI 供应商 / 引导状态），主进程 settings.json 持久化。
 * 纯浏览器环境（host undefined）下用内存默认值降级。
 */

/** 规范化供应商列表：trim 字符串字段、去掉空模型名（保存前调用） */
export function normalizeProviders(providers: ProviderConfig[]): ProviderConfig[] {
  return providers.map(p => ({
    ...p,
    name: p.name.trim(),
    baseUrl: p.baseUrl.trim(),
    apiKey: p.apiKey.trim(),
    models: p.models.map(m => m.trim()).filter(m => m.length > 0)
  }));
}

const DEFAULTS: AppSettings = {
  workingDirectory: '',
  permissionMode: 'confirm',
  providers: [],
  onboardingDone: false
};

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...DEFAULTS });
  const loaded = ref(false);

  // in-flight 去重：App.vue 与路由守卫会并发触发 load
  let loadPromise: Promise<void> | null = null;

  async function load(): Promise<void> {
    if (loaded.value) return;
    if (!loadPromise) {
      loadPromise = (async () => {
        if (!host) {
          // 纯浏览器环境无持久化，按已引导处理，跳过引导页
          settings.value = { ...DEFAULTS, onboardingDone: true };
        } else {
          settings.value = await host.getSettings();
        }
        loaded.value = true;
      })();
    }
    await loadPromise;
  }

  async function save(patch: SettingsPatch): Promise<void> {
    if (!host) {
      settings.value = { ...settings.value, ...patch };
      return;
    }
    settings.value = await host.setSettings(patch);
  }

  return { settings, loaded, load, save };
});
