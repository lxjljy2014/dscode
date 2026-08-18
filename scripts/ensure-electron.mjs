import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * 预下载 Electron 二进制（npmmirror 镜像）。
 *
 * 背景：electron@43 起 package.json 不再有 postinstall，改为首次 require 时懒下载，
 * .pnpmfile.cjs 里注入的 process.env.ELECTRON_MIRROR 不会被子进程继承（懒下载发生在
 * electron-vite 等独立进程里），因此只能在这里显式跑 electron/install.js。
 * install.js 幂等（二进制已存在时直接 exit 0），失败不阻断安装（可稍后按默认源懒下载）。
 */
const require = createRequire(import.meta.url);
let installJs;
try {
  installJs = require.resolve('electron/install.js');
} catch {
  process.exit(0); // electron 未安装（部分 CI / 精简安装），跳过
}

// 镜像选择：本地默认走 npmmirror（国内快）；CI（GitHub Actions 等境外机器）走官方源，避免国内镜像拖慢
const env = { ...process.env };
const mirror = process.env.ELECTRON_MIRROR || (process.env.CI ? '' : 'https://npmmirror.com/mirrors/electron/');
if (mirror) env.ELECTRON_MIRROR = mirror;

const result = spawnSync(process.execPath, [installJs], {
  stdio: 'inherit',
  env
});
if (result.status !== 0) {
  console.warn('[ensure-electron] 预下载 Electron 失败（退出码 ' + result.status + '），pnpm dev 时会按默认源懒下载');
}
