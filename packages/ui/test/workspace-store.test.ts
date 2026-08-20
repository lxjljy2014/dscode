import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { FileNode } from '@dscode/shared';

/** workspace store：扁平索引、选中读取、过期响应丢弃、内容缓存 LRU */

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  workspaceTree: vi.fn(),
  workspaceReadFile: vi.fn()
}));

vi.mock('../src/bridge/host', () => ({
  host: {
    getSettings: mocks.getSettings,
    setSettings: mocks.setSettings,
    workspaceTree: mocks.workspaceTree,
    workspaceReadFile: mocks.workspaceReadFile
  }
}));

import { useWorkspaceStore } from '../src/stores/workspace';

const tree: FileNode[] = [
  {
    name: 'src',
    path: 'src',
    type: 'dir',
    children: [
      { name: 'a.ts', path: 'src/a.ts', type: 'file' },
      { name: 'b.ts', path: 'src/b.ts', type: 'file' }
    ]
  },
  { name: 'readme.md', path: 'readme.md', type: 'file' }
];

beforeEach(() => {
  setActivePinia(createPinia());
  mocks.workspaceTree.mockReset().mockResolvedValue(tree);
  mocks.workspaceReadFile.mockReset();
  mocks.getSettings.mockReset().mockResolvedValue({
    workingDirectory: 'D:/ws', permissionMode: 'confirm', providers: [], onboardingDone: true,
    commands: [], memory: [], skills: [], hooks: [], subagents: [], mcpServers: [],
    browsingEnabled: true, autoCompact: true, autoCompactThreshold: 80
  });
  mocks.setSettings.mockReset().mockImplementation(p => Promise.resolve(p));
});

describe('useWorkspaceStore', () => {
  it('import 时加载文件树；扁平索引支撑 selectedFile 查表', async () => {
    const store = useWorkspaceStore();
    await new Promise(r => setTimeout(r, 0));
    expect(store.fileTree).toEqual(tree);
    // dir 节点不可选中；嵌套文件与根级文件均可命中
    store.selectedFilePath = 'src/a.ts';
    expect(store.selectedFile?.name).toBe('a.ts');
    store.selectedFilePath = 'readme.md';
    expect(store.selectedFile?.name).toBe('readme.md');
    store.selectedFilePath = 'src';
    expect(store.selectedFile).toBeNull();
    store.selectedFilePath = 'not-exist.ts';
    expect(store.selectedFile).toBeNull();
  });

  it('selectFile 读取内容并填充 selectedFile', async () => {
    const store = useWorkspaceStore();
    await new Promise(r => setTimeout(r, 0));
    mocks.workspaceReadFile.mockResolvedValue({ ok: true, content: 'export {};' });
    await store.selectFile('src/a.ts');
    expect(store.selectedFilePath).toBe('src/a.ts');
    expect(store.selectedFile?.content).toBe('export {};');
    expect(store.selectedFile?.name).toBe('a.ts');
  });

  it('过期响应丢弃：快速切换时旧响应不覆盖新选中', async () => {
    const store = useWorkspaceStore();
    await new Promise(r => setTimeout(r, 0));
    let resolveA: (v: { ok: true; content: string }) => void = () => {};
    mocks.workspaceReadFile.mockImplementationOnce(
      () => new Promise(r => { resolveA = r; })
    );
    mocks.workspaceReadFile.mockResolvedValueOnce({ ok: true, content: 'B' });
    const pA = store.selectFile('src/a.ts');
    const pB = store.selectFile('src/b.ts');
    await pB;
    resolveA({ ok: true, content: 'A' });
    await pA;
    expect(store.selectedFile?.content).toBe('B');
    expect(store.fileContents['src/a.ts']).toBeUndefined();
  });

  it('读取失败时内容显示错误占位', async () => {
    const store = useWorkspaceStore();
    await new Promise(r => setTimeout(r, 0));
    mocks.workspaceReadFile.mockResolvedValue({ ok: false, error: '文件过大' });
    await store.selectFile('src/a.ts');
    expect(store.selectedFile?.content).toContain('文件过大');
  });

  it('内容缓存 LRU：超过 32 个文件淘汰最旧，当前选中保留', async () => {
    const store = useWorkspaceStore();
    await new Promise(r => setTimeout(r, 0));
    // 树里只有 3 个文件，直接往缓存塞 35 个再触发一次写入验证淘汰行为
    const contents = store.fileContents as Record<string, string>;
    for (let i = 0; i < 35; i++) {
      contents[`f${i}.ts`] = `c${i}`;
    }
    mocks.workspaceReadFile.mockImplementation(() => Promise.resolve({ ok: true, content: 'c' }));
    await store.selectFile('src/a.ts');
    const keys = Object.keys(store.fileContents);
    expect(keys.length).toBeLessThanOrEqual(33); // 32 + 当前选中（可能额外保留）
    // 最旧的 f0 被淘汰，新写入的仍在
    expect(store.fileContents['f0.ts']).toBeUndefined();
    expect(store.fileContents['f34.ts']).toBe('c34');
    expect(store.fileContents['src/a.ts']).toBe('c');
  });
});
