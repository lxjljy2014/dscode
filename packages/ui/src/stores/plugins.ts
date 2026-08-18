import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Command, Plugin } from '@dscode/shared';
import { host } from '../bridge/host';

/**
 * 插件 store：从主进程拉取已加载的插件列表，供设置页展示与输入框命令合并。
 */
export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<Plugin[]>([]);
  const loaded = ref(false);
  let loadPromise: Promise<void> | null = null;

  async function load(): Promise<void> {
    if (loaded.value || !host) return;
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          plugins.value = await host.pluginsList();
          loaded.value = true;
        } catch (e) {
          // 失败重置：下一次 load 重试，避免被 rejected Promise 永久卡住
          loadPromise = null;
          throw e;
        }
      })();
    }
    await loadPromise;
  }

  /** 插件贡献的全部斜杠命令 */
  const commands = computed<Command[]>(() => plugins.value.flatMap(p => p.commands ?? []));

  return { plugins, commands, loaded, load };
});
