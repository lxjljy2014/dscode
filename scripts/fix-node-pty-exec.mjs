/**
 * 修复 node-pty 预编译产物里 spawn-helper 缺失的可执行位。
 * 从 npm 解包后该文件权限为 644，导致 posix_spawnp 无法启动 helper，
 * pty.fork 抛 "posix_spawnp failed"。由根 package.json 的 postinstall 调用
 * （pnpm 会执行 root 项目的 postinstall）。
 */
import { chmodSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const storeDir = join(root, 'node_modules', '.pnpm');

let entries = [];
try {
  entries = readdirSync(storeDir);
} catch {
  // 依赖尚未安装（如首次 install 前），直接跳过
  process.exit(0);
}

for (const entry of entries) {
  if (!entry.startsWith('node-pty@')) continue;
  const prebuildsDir = join(storeDir, entry, 'node_modules', 'node-pty', 'prebuilds');
  let platforms = [];
  try {
    platforms = readdirSync(prebuildsDir);
  } catch {
    continue;
  }
  for (const platform of platforms) {
    const helper = join(prebuildsDir, platform, 'spawn-helper');
    try {
      const st = statSync(helper);
      // 仅 Unix 平台存在 spawn-helper（Windows 是 winpty-agent.exe）
      if (st.isFile() && (st.mode & 0o111) === 0) chmodSync(helper, 0o755);
    } catch {
      // 平台无该文件时忽略
    }
  }
}
