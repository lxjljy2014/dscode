/**
 * 网络 SSRF 防护（browse / provider:verify / browser:fetch 共用）：
 * 校验 URL 是否为公网 http(s) 地址，封禁本机/内网/链路本地/保留地址。
 * 覆盖常见绕过：尾点、IPv4-mapped IPv6（::ffff:）、十进制/十六进制/八进制 IP 表示。
 */

/** 归一化主机名：小写、去首尾空白、去方括号、去尾点、IPv4-mapped IPv6 归一到 IPv4 段 */
function normalizeHostname(hostname: string): string {
  let h = hostname.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h.startsWith('::ffff:')) h = h.slice('::ffff:'.length);
  return h;
}

/** 按 IPv4 前两段判断私网/保留地址（与历史实现语义一致，补充多播/保留段） */
function isPrivateIpv4(a: number, b: number): boolean {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** 拦截本机/内网/链路本地/保留地址，防 SSRF */
export function isPrivateHost(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::' || h === '::1') return true;
  // IPv6 链路本地（fe80::/10）与唯一本地地址 ULA（fc00::/7）
  if (/^fe80:/i.test(h) || /^f[cd][0-9a-f]{2}:/i.test(h)) return true;
  const dotted = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) return isPrivateIpv4(Number(dotted[1]), Number(dotted[2]));
  // IPv4-mapped IPv6 的十六进制形式（::ffff:7f00:1 = 127.0.0.1，Node URL 会把点分形式归一到此处）
  const mapped = h.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mapped) {
    const hi = parseInt(mapped[1]!, 16);
    if (Number.isFinite(hi)) return isPrivateIpv4((hi >> 8) & 0xff, hi & 0xff);
  }
  // 十进制/十六进制/八进制 IP 表示（2130706433 / 0x7f000001 / 0177...）归一为整数判私网；
  // 注意顺序：0x/0 前缀须先于十进制判定，避免八进制（017700000001）被当十进制误判
  let ipInt: number | null = null;
  if (/^0x[0-9a-f]+$/i.test(h)) ipInt = parseInt(h, 16);
  else if (/^0[0-7]+$/.test(h)) ipInt = parseInt(h, 8);
  else if (/^\d+$/.test(h)) ipInt = Number(h);
  if (ipInt !== null && Number.isFinite(ipInt) && ipInt >= 0 && ipInt <= 0xffffffff) {
    return isPrivateIpv4((ipInt >>> 24) & 0xff, (ipInt >>> 16) & 0xff);
  }
  return false;
}
