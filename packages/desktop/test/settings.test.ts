import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// mock electron 的 safeStorage（vi.hoisted 供 mock 工厂在提升后仍能访问）
const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((s: string) => Buffer.from('x:' + s, 'utf8')),
  decryptString: vi.fn((b: Buffer) => b.toString('utf8').replace(/^x:/, ''))
}));

vi.mock('electron', () => ({ safeStorage }));

import { loadAppSettings, saveAppSettings } from '../src/main/settings';

let dir: string;
let configDir: string;
const home = '/home/u';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dscode-settings-'));
  configDir = join(dir, 'config');
  await mkdir(configDir, { recursive: true });
  vi.clearAllMocks();
  safeStorage.isEncryptionAvailable.mockReturnValue(true);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadAppSettings / saveAppSettings', () => {
  it('文件不存在时返回默认设置', () => {
    const s = loadAppSettings(configDir, home);
    expect(s.workingDirectory).toBe(home);
    expect(s.onboardingDone).toBe(false);
  });

  it('apiKey 落盘加密（enc:v1: 前缀），读回解密为明文', async () => {
    const provider = {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-secret',
      models: ['m']
    };
    const saved = saveAppSettings(configDir, home, { providers: [provider] });
    expect(saved.providers[0]?.apiKey).toBe('sk-secret');
    const raw = await readFile(join(configDir, 'providers.json'), 'utf8');
    expect(raw).toContain('enc:v1:');
    expect(raw).not.toContain('sk-secret');
    expect(loadAppSettings(configDir, home).providers[0]?.apiKey).toBe('sk-secret');
  });

  it('空 apiKey 不加密（保持空串）', async () => {
    saveAppSettings(configDir, home, {
      providers: [{ id: 'p', name: 'P', baseUrl: 'https://x', apiKey: '', models: ['m'] }]
    });
    expect(await readFile(join(configDir, 'providers.json'), 'utf8')).not.toContain('enc:v1:');
  });

  it('系统不支持加密时回退明文存储', async () => {
    safeStorage.isEncryptionAvailable.mockReturnValue(false);
    saveAppSettings(configDir, home, {
      providers: [{ id: 'p', name: 'P', baseUrl: 'https://x', apiKey: 'sk-plain', models: ['m'] }]
    });
    const raw = await readFile(join(configDir, 'providers.json'), 'utf8');
    expect(raw).toContain('sk-plain');
    expect(raw).not.toContain('enc:v1:');
  });

  it('解密失败时原样返回密文（不丢设置）', async () => {
    safeStorage.decryptString.mockImplementationOnce(() => {
      throw new Error('decrypt failed');
    });
    await writeFile(
      join(configDir, 'settings.json'),
      JSON.stringify({
        workingDirectory: home,
        permissionMode: 'confirm',
        onboardingDone: false,
        providers: [{ id: 'p', name: 'P', baseUrl: 'https://x', apiKey: 'enc:v1:broken', models: ['m'] }]
      })
    );
    expect(loadAppSettings(configDir, home).providers[0]?.apiKey).toBe('enc:v1:broken');
  });
});