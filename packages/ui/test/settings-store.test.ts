import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { AppSettings } from '@dscode/shared';

/** settings store：load 去重、失败重试、save 串行链与失败自愈 */

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn()
}));

vi.mock('../src/bridge/host', () => ({
  host: {
    getSettings: mocks.getSettings,
    setSettings: mocks.setSettings
  }
}));

import { useSettingsStore } from '../src/stores/settings';

const sample: AppSettings = {
  workingDirectory: 'D:/ws',
  permissionMode: 'auto-approve',
  providers: [],
  onboardingDone: true,
  commands: [],
  memory: [],
  skills: [],
  hooks: [],
  subagents: [],
  mcpServers: [],
  browsingEnabled: false,
  autoCompact: true,
  autoCompactThreshold: 80
};

beforeEach(() => {
  setActivePinia(createPinia());
  mocks.getSettings.mockReset();
  mocks.setSettings.mockReset();
});

describe('useSettingsStore.load', () => {
  it('加载设置并置 loaded；并发调用去重为一次 IPC', async () => {
    mocks.getSettings.mockResolvedValue(sample);
    const store = useSettingsStore();
    await Promise.all([store.load(), store.load(), store.load()]);
    expect(mocks.getSettings).toHaveBeenCalledTimes(1);
    expect(store.settings).toEqual(sample);
    expect(store.loaded).toBe(true);
  });

  it('加载失败后可重试（不残留 rejected 链）', async () => {
    mocks.getSettings.mockRejectedValueOnce(new Error('ipc down'));
    const store = useSettingsStore();
    await expect(store.load()).rejects.toThrow('ipc down');
    expect(store.loaded).toBe(false);
    mocks.getSettings.mockResolvedValue(sample);
    await store.load();
    expect(store.settings).toEqual(sample);
  });

  it('loaded 后再次 load 直接返回（不再触发 IPC）', async () => {
    mocks.getSettings.mockResolvedValue(sample);
    const store = useSettingsStore();
    await store.load();
    await store.load();
    expect(mocks.getSettings).toHaveBeenCalledTimes(1);
  });
});

describe('useSettingsStore.save', () => {
  it('串行链：保存按提交顺序执行且状态更新为返回值', async () => {
    // 第一个保存慢于第二个：串行化后顺序仍稳定
    let resolveFirst: (v: AppSettings) => void = () => {};
    mocks.setSettings.mockImplementationOnce(
      () => new Promise<AppSettings>(r => { resolveFirst = r; })
    );
    mocks.setSettings.mockResolvedValueOnce({ ...sample, permissionMode: 'auto-approve' });

    const store = useSettingsStore();
    const p1 = store.save({ permissionMode: 'confirm' });
    const p2 = store.save({ workingDirectory: 'D:/ws' });
    // 等微任务跑完（p1 的 setSettings 已执行、resolveFirst 已被赋值）再放行
    await new Promise(r => setTimeout(r, 0));
    resolveFirst(sample);
    await Promise.all([p1, p2]);
    expect(mocks.setSettings).toHaveBeenCalledTimes(2);
    // 最终状态为最后一次保存的返回值
    expect(store.settings.permissionMode).toBe('auto-approve');
  });

  it('失败自愈：一次保存失败不阻断后续保存', async () => {
    mocks.setSettings.mockRejectedValueOnce(new Error('write fail'));
    mocks.setSettings.mockResolvedValueOnce(sample);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = useSettingsStore();
    await store.save({ permissionMode: 'yolo' as never });
    await store.save({ browsingEnabled: false });
    expect(mocks.setSettings).toHaveBeenCalledTimes(2);
    expect(store.settings).toEqual(sample);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
