import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyProvider } from '../src/persist/provider';

afterEach(() => vi.unstubAllGlobals());

describe('verifyProvider（fetch 路径）', () => {
  it('200 返回 ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    expect(await verifyProvider('https://api.example.com', 'sk')).toEqual({ ok: true });
  });

  it('401/403 返回 unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401 }));
    expect(await verifyProvider('https://api.example.com', 'sk')).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('其它非 2xx 返回 network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500 }));
    expect(await verifyProvider('https://api.example.com', 'sk')).toEqual({ ok: false, reason: 'network' });
  });

  it('fetch 抛错返回 network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    expect(await verifyProvider('https://api.example.com', 'sk')).toEqual({ ok: false, reason: 'network' });
  });
});

describe('verifyProvider（模型列表拉取）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('200 且 OpenAI 格式响应：返回拉取到的模型列表', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        json: async () => ({ data: [{ id: 'm-a' }, { id: 'm-b' }, { notId: true }, { id: '' }] })
      })
    );
    expect(await verifyProvider('https://api.example.com', 'sk')).toEqual({ ok: true, models: ['m-a', 'm-b'] });
  });

  it('200 但非 OpenAI 格式（空 data/其它结构）：ok 不带 models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, json: async () => ({ object: 'list' }) })
    );
    expect(await verifyProvider('https://api.example.com', 'sk')).toEqual({ ok: true });
    // json 抛错同样不影响校验结论
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, json: async () => { throw new Error('bad'); } }));
    expect(await verifyProvider('https://api.example.com', 'sk')).toEqual({ ok: true });
  });
});

describe('verifyProvider（本地推理服务放行）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('http 回环地址放行（Ollama / LM Studio）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    expect(await verifyProvider('http://localhost:11434/v1', 'sk')).toEqual({ ok: true });
    expect(await verifyProvider('http://127.0.0.1:1234', 'sk')).toEqual({ ok: true });
  });

  it('http 非回环地址仍拒绝（SSRF 防护不放松）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    expect(await verifyProvider('http://api.example.com', 'sk')).toEqual({ ok: false, reason: 'invalid-args' });
    expect(await verifyProvider('http://192.168.1.10:8080', 'sk')).toEqual({ ok: false, reason: 'invalid-args' });
  });

  it('https 内网地址仍拒绝', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
    expect(await verifyProvider('https://127.0.0.1', 'sk')).toEqual({ ok: false, reason: 'invalid-args' });
    expect(await verifyProvider('https://10.0.0.5', 'sk')).toEqual({ ok: false, reason: 'invalid-args' });
  });
});
