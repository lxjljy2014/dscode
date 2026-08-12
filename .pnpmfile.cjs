// pnpm 钩子文件（pnpm 启动时在同进程加载）
// 作用：为 Electron 二进制下载注入 npmmirror 镜像。
// 注意：.npmrc 里的 electron_mirror 对 pnpm 无效——pnpm 不会像 npm 那样
// 把 .npmrc 配置转成 npm_config_* 环境变量传给 postinstall，所以只能在这里
// 直接写 process.env（postinstall 子进程会继承）。
if (!process.env.ELECTRON_MIRROR) {
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
}

module.exports = {
  hooks: {},
}
