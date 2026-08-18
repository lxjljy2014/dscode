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
