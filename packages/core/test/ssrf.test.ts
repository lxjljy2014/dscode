import { describe, expect, it } from 'vitest';
import { isPrivateHost } from '../src/net/ssrf';
import { verifyProvider } from '../src/persist/provider';

/** SSRF 防护：主机名私网判定与 provider 校验的私网封禁 */

describe('isPrivateHost', () => {
  it('公网主机放行', () => {
    expect(isPrivateHost('example.com')).toBe(false);
    expect(isPrivateHost('api.openai.com')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    expect(isPrivateHost('151.101.1.69')).toBe(false);
  });

  it('本机/内网/链路本地/保留地址拦截', () => {
    expect(isPrivateHost('localhost')).toBe(true);
    expect(isPrivateHost('sub.localhost')).toBe(true);
    expect(isPrivateHost('127.0.0.1')).toBe(true);
    expect(isPrivateHost('10.0.0.1')).toBe(true);
    expect(isPrivateHost('172.16.0.1')).toBe(true);
    expect(isPrivateHost('172.31.255.255')).toBe(true);
    expect(isPrivateHost('192.168.1.1')).toBe(true);
    expect(isPrivateHost('169.254.169.254')).toBe(true);
    expect(isPrivateHost('0.0.0.0')).toBe(true);
    expect(isPrivateHost('224.0.0.1')).toBe(true);
    expect(isPrivateHost('::1')).toBe(true);
    expect(isPrivateHost('fe80::1')).toBe(true);
    expect(isPrivateHost('fc00::1')).toBe(true);
  });

  it('绕过形态：尾点 / IPv4-mapped IPv6 / 十进制/十六进制/八进制 IP', () => {
    expect(isPrivateHost('127.0.0.1.')).toBe(true);
    expect(isPrivateHost('[::ffff:127.0.0.1]')).toBe(true);
    expect(isPrivateHost('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateHost('2130706433')).toBe(true); // 十进制 127.0.0.1
    expect(isPrivateHost('0x7f000001')).toBe(true); // 十六进制 127.0.0.1
    expect(isPrivateHost('017700000001')).toBe(true); // 八进制 127.0.0.1
  });

  it('公网整数 IP 放行', () => {
    expect(isPrivateHost('0x08080808')).toBe(false); // 8.8.8.8
  });
});

describe('verifyProvider 私网封禁', () => {
  it('私网 https baseUrl 返回 invalid-args（不发起请求）', async () => {
    expect(await verifyProvider('https://192.168.1.1', 'sk')).toEqual({ ok: false, reason: 'invalid-args' });
    expect(await verifyProvider('https://127.0.0.1', 'sk')).toEqual({ ok: false, reason: 'invalid-args' });
  });

  it('非 https 协议返回 invalid-args', async () => {
    expect(await verifyProvider('http://api.example.com', 'sk')).toEqual({ ok: false, reason: 'invalid-args' });
  });

  it('空 key 返回 invalid-args', async () => {
    expect(await verifyProvider('https://api.example.com', '')).toEqual({ ok: false, reason: 'invalid-args' });
  });
});
