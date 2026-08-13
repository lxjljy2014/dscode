# AGENTS.md

> 面向 AI 编码代理的项目说明。假设读者对本项目一无所知。

## 项目概览

**DSCode** 是一个 AI 编程助手的桌面端应用（类似 coding agent 的 GUI 客户端），基于 **Electron + Vue 3 + TypeScript**。已接入真实 agent 能力：主进程 agent 运行时（DeepSeek/OpenAI 兼容 API 流式对话 + 工具循环），聊天/文件树/diff 均为真实数据（`packages/shared/src/mock` 仅作为纯浏览器降级与历史 mock 数据保留）。

主要界面：

- 工作区（`/` 路由）：左侧会话栏 + 顶栏 + 聊天区 + 右侧 diff/文件面板 + 底部终端面板
- 设置页（`/settings/:section`）：设置导航 + 各设置版块（仅 general 已实现，其余为占位页）

## 仓库结构（pnpm monorepo）

```
packages/
├── desktop/          # @dscode/desktop —— Electron 应用壳（主进程 / preload / 渲染入口）
│   ├── electron.vite.config.ts
│   ├── uno.config.ts
│   └── src/
│       ├── main/     # Electron 主进程（index.ts 窗口/IPC；agent.ts agent 循环（SSE 流式+工具调用）；agent-tools.ts 工具集（读/列/搜/命令/写/编辑）；agent-gate.ts 权限门控；workspace.ts 文件树/读文件；diff.ts 快照行级 diff；sessions.ts 会话 SQLite；git.ts git CLI 封装；projects.ts 最近项目 SQLite；config.ts settings 持久化；terminal.ts 集成终端 node-pty 会话；ipc.ts 业务 handler）
│       ├── preload/  # contextBridge 暴露 window.dscode
│       └── renderer/ # Vue 应用入口（App.vue / router.ts / main.ts）
├── shared/           # @dscode/shared —— 纯 TS：类型定义、mock 数据（仅浏览器降级用）、i18n 语言包
│   └── src/
│       ├── types/    # Session / Message / DiffFile / FileNode / AgentToolEvent 等类型
│       ├── mock/     # mockSessions / mockDiffFiles / mockFileTree（纯浏览器环境降级）
│       └── locales/  # zh-CN.json / en-US.json
└── ui/               # @dscode/ui —— 全部 UI：组件、Pinia stores、插件、主题
    └── src/
        ├── components/  # 20 个 Vue SFC（WorkspaceView、ChatView、DiffPanel、ToolEventCard、ResizeHandle、GitGraphDialog 等）
        ├── stores/      # ui.ts（主题/语言/侧栏显隐/面板尺寸）、session.ts（会话/agent 事件分发/持久化）、settings.ts（工作目录/权限模式，主进程持久化）
        ├── plugins/     # vuetify.ts、i18n.ts（createXxxPlugin 工厂函数）
        ├── theme/       # tokens.ts（主题色唯一事实源）、global.css（滚动条/选区/拖拽区）
        └── host.ts      # window.dscode 桥接 API 的类型封装
```

包间依赖：`desktop` → `ui` → `shared`。workspace 包直接以 TS 源码导出（`exports` 指向 `src/*.ts`），无需预先构建，由 electron-vite 一并编译。

## 技术栈

| 层         | 选型                                                                          |
| ---------- | ----------------------------------------------------------------------------- |
| 桌面壳     | Electron 43，electron-vite 5 构建（main/preload/renderer 三目标）             |
| UI 框架    | Vue 3.5（`<script setup lang="ts">`）+ Vuetify 4（autoImport，sass 变量定制） |
| 原子化 CSS | UnoCSS（presetWind4 + presetIcons/Lucide），与 Vuetify 共存                   |
| 状态       | Pinia 3（setup 风格 store）                                                   |
| 路由       | vue-router 4，hash 模式（`createWebHashHistory`）                             |
| 国际化     | vue-i18n 11（`zh-CN` / `en-US`，默认中文）                                    |
| 包管理     | **pnpm 11.17.0**（workspace，必须用 pnpm，不要用 npm/yarn）                   |
| 语言       | TypeScript 5.9，strict 模式                                                   |

## 常用命令

所有命令在仓库根目录执行（root scripts 只是 `--filter @dscode/desktop` 的转发）：

```bash
pnpm install        # 安装依赖（首次必须，electron 需要 postinstall 下载二进制）
pnpm dev            # 启动 electron-vite 开发模式（HMR）
pnpm build          # 构建到 packages/desktop/out/
pnpm start          # 预览构建产物（electron-vite preview）
pnpm typecheck      # vue-tsc（renderer+ui+shared）+ tsc（main/preload）
pnpm lint           # ESLint + oxlint 全量
pnpm lint:fast      # 仅 oxlint（毫秒级快速反馈）
pnpm lint:eslint    # 仅 ESLint
pnpm lint:fix       # 两个 linter 自动修复
pnpm fmt            # oxfmt 格式化
```

注意：**当前没有测试框架、没有 CI**。改动后至少跑 `pnpm typecheck` + `pnpm lint` 验证。

Electron 二进制通过 `.pnpmfile.cjs` 注入 `ELECTRON_MIRROR`（npmmirror 镜像）下载；`.npmrc` 的 `electron_mirror` 对 pnpm 无效（pnpm 不会把 `.npmrc` 配置转成 `npm_config_*` 环境变量传给 postinstall），不要回退到那种写法。注意 `.pnpmfile.cjs` 内容变化会使 lockfile 的 `pnpmfileChecksum` 失效，需执行一次 `pnpm install --no-frozen-lockfile` 更新。

`pnpm-workspace.yaml` 里的 `allowBuilds` 是 pnpm 11 的依赖构建白名单（当前已登记：`electron`、`esbuild`、`sass-embedded`、`@parcel/watcher`、`node-pty`）：**新增带 postinstall 的原生依赖必须在此登记，否则其 build scripts 不会执行**；`minimumReleaseAgeExclude` 用于绕过 electron 的发布年龄检查（目前登记了 `electron@43.4.0`）。

node-pty 的预编译产物里 `spawn-helper` 从 npm 解包后丢失可执行位（644），导致 pty 启动报 `posix_spawnp failed`；根 `postinstall`（`scripts/fix-node-pty-exec.mjs`，pnpm 会执行 root 项目的 postinstall）负责修复，不要删。

开发模式两个配置陷阱（`renderer/index.html` / `src/boot.ts`）：

- dev 冷启动时 vite-plugin-vuetify 的虚拟样式模块（`virtual:plugin-vuetify:*`）偶发 404、应用无法挂载（刷新后服务器已暖、正常）。`index.html` 里的 `.app-splash` 启动占位页（应用图标图片 `./icon.png`（`renderer/public/` 方形原图；`resources/icon.png` 为经 `scripts/make-icon-rounded.mjs` 预处理的透明圆角版，供 macOS Dock——Dock 不会自动给自定义图标加圆角；`resources/icon-win.png` 为同脚本按 `contentScale=1` 生成的满幅圆角版（内容满幅、圆角外透明），供 Windows/Linux 窗口/任务栏图标）+ 同步光晕 + 环境光背景，5s 周期轻微呼吸、无任何文字，背景色对齐 tokens 的 neutral 色阶，深浅色由 boot.ts 按持久化主题打 `ds-theme-dark`/`ds-theme-light` 类、回退系统偏好）盖住加载期黑屏；`src/boot.ts`（先于 main.ts 加载）在 dev 下 10 秒未挂载时自动刷新一次（sessionStorage 防循环），让失败自愈。两者都别删。
- CSP 里 `worker-src 'self' blob:` 必须保留：Vite 7 dev client 会创建 blob worker，被 `script-src 'self'` 拦截会在控制台报错。

## 代码约定

- **注释与文档使用中文**（项目现有注释均为中文，git commit 也是中文）。标识符用英文。
- Vue 组件一律 `<script setup lang="ts">`；样式优先用 UnoCSS 工具类写在 `class` 里，配合 Vuetify 组件 props，基本不写 `<style>` 块。
- 图标用 UnoCSS 图标语法：`i-lucide:xxx`（已按 Vuetify 官方文档集成 Lucide iconset）。
- 文案一律走 i18n：key 加到 `packages/shared/src/locales/zh-CN.json` 和 `en-US.json` 两个文件，组件里 `t('xxx')`。
- 可复用 UI 放 `packages/ui`（并在 `src/index.ts` 导出），Electron 宿主相关的薄壳代码放 `packages/desktop`。`TerminalPanel` 是个例外：它未被 `index.ts` 导出，由 `WorkspaceView` 相对路径直接引用。
- 集成终端由 `ui/components/TerminalPanel.vue`（xterm.js + FitAddon，多标签页会话：面板内容 v-show 常驻、新增/关闭标签驱动会话创建/回收）与 `desktop/src/main/terminal.ts`（node-pty 多会话管理）配合实现；终端配色（含 ANSI 16 色 `terminalAnsi`）在 `theme/tokens.ts` 定义，不在组件里写死。
- 面板尺寸拖拽用 `ui/components/ResizeHandle.vue`（Pointer Events 遮罩式拖拽条，定位上下文是抽屉根元素、高亮细线与抽屉外缘边框重合）：`axis="y"` 调终端高度、`axis="x"` 调右侧栏宽度；范围限制写在各面板组件的 `*_MIN_*` / `*_MAX_*` 常量，尺寸状态存 `ui.ts` store（不持久化，每次启动恢复默认）。
- 跨包引用用包名（`@dscode/shared`、`@dscode/ui`、`@dscode/ui/tokens`），TS 路径别名在根 `tsconfig.base.json` 配置；渲染进程内部还有 `@renderer` 别名指向 `packages/desktop/src/renderer/src`。
- tsconfig 项目解析（构建与编辑器分两套，别删）：构建/typecheck 用 `packages/desktop/tsconfig.web.json`（renderer+ui+shared，vue-tsc）与 `tsconfig.node.json`（main/preload，tsc）。部分编辑器只按目录向上找 `tsconfig.json`（会误用 ES5 推断项目报 TS1343/TS2705），为此提供两个垫片：根 `tsconfig.json`（覆盖 ui/shared）与 `packages/desktop/src/renderer/tsconfig.json`（覆盖 renderer，含 vite/client 类型）。`.vue` 模块声明在 `packages/ui/src/env.d.ts`（全包共用），renderer 的 `env.d.ts` 只放 vite/client 引用与 process.env.NODE_ENV 声明。

## 主题系统（改动前必读）

颜色的**唯一事实源**是 `packages/ui/src/theme/tokens.ts`：

1. `neutral` 中性色阶 → 2. Vuetify `lightTheme`/`darkTheme` 语义色 → 3. Vuetify 生成 `--v-theme-*` CSS 变量 → 4. `unoColors` 把这些变量映射为 UnoCSS 颜色类（`bg-surface`、`text-muted`、`border-line` 等）。

**不要**在组件里写死颜色值；新增颜色时按上述链路添加。UnoCSS 关闭了 reset 预检（避免与 Vuetify reset 冲突），图标 preset 删掉了 color 属性（Vuetify 要求），详见 `packages/desktop/uno.config.ts` 注释。

## Electron 主进程要点

- 无边框窗口（`titleBarStyle: 'hidden'`）：macOS 用 `trafficLightPosition` 悬浮红绿灯，Windows 用 `titleBarOverlay` 原生悬浮按钮（背景色固定透明，渲染端主题切换时经 IPC `win:set-titlebar-overlay` 只同步 `symbolColor` 符号色）。渲染端需为系统控件预留位置，相关常量在 `@dscode/ui` 的 `host.ts`（`TITLEBAR_OVERLAY_WIDTH = 150`，macOS 左侧让位 84px）。
- 渲染端通过 `.ds-drag` / `.ds-no-drag` CSS 类处理标题栏拖拽区（见 `global.css`）。
- 安全设置：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`；外部链接一律 `shell.openExternal`，`window.open` 被 deny。
- preload 只暴露 `window.dscode`（platform、versions、setTitleBarOverlay + 业务 IPC 封装）；纯浏览器环境下为 `undefined`，组件须降级处理。
- **业务 IPC 通道**（全部 `ipcMain.handle` / `ipcRenderer.invoke`，定义在 `desktop/src/main/ipc.ts`，渲染端类型见 `@dscode/ui` 的 `host.ts`）：
  - `settings:get` / `settings:set` —— 工作目录 + 权限模式（`userData/settings.json` 持久化；set 时工作目录变化自动记入最近项目）
  - `projects:list` —— 最近项目（`node:sqlite`，`userData/projects.db`，无原生依赖）
  - `dialog:pick-directory` —— 选择工作目录（取消返回 null）
  - `provider:verify` —— API key 校验（主进程 fetch `GET {baseUrl}/models`）
  - `agent:start` / `agent:stop` / `agent:confirm-response` —— agent 运行（主进程 `agent.ts`：SSE 流式 + 工具循环 + 门控；配置由主进程读 settings，渲染端只传 sessionId/model/messages，不可注入 baseUrl/key）；事件推流 `agent:delta`（文本增量）/ `agent:tool`（工具状态流转）/ `agent:confirm`（写/执行确认请求，120s 超时自动拒绝）/ `agent:done` / `agent:error`（code: no-api-key/api/network/aborted/unknown），均带 sessionId
  - `workspace:tree` / `workspace:read-file` —— 真实文件树扫描与文件读取（路径限定工作目录内）；`workspace:diff` 事件 —— 写/执行工具后主进程按「agent 启动快照 vs 当前内容」LCS 行级 diff 推送
  - `sessions:list` / `sessions:create` / `sessions:append` —— 会话持久化（`node:sqlite`，`userData/sessions.db`，toolEvents 不落库）
  - `git:list-branches` / `git:checkout` / `git:create-branch` / `git:graph` —— git CLI（`child_process.execFile` 参数数组，不经 shell）；结果统一 `{ok}` 判别联合
  - `terminal:ensure` / `terminal:write` / `terminal:resize` / `terminal:kill` —— 集成终端（主进程 node-pty，多会话按渲染端生成的 sessionId 管理、按窗口归属统一回收，见 `main/terminal.ts`）；pty 输出经 `terminal:data` / `terminal:exit` 事件（带 sessionId）推给渲染端，write/resize 为高频单向 `on` 通道
  - 每个 handler 校验 sender 属于主窗口 + 参数类型；新增业务 IPC 沿用此模式

## 测试与质量

- 无单元测试 / E2E 测试设施。若引入测试，需自行选型并在本节补充说明。
- **lint 双轨并存**（配置都在仓库根）：
  - `oxlint`（`.oxlintrc.json`）：Rust 实现、毫秒级；内置 vue 插件 lint `.vue` 的 `<script>` 块（模板规则暂缺，官方语言插件路线图中）；自动读取 `.gitignore` 排除产物。**负责全部 TS/JS 文件**
  - `eslint`（`eslint.config.js`，flat config，基于 `@soybeanjs/eslint-config-vue`）：**仅覆盖 `.vue` 文件**（soybean 的 defineConfig 硬编码 `files: ['**/*.vue']`），提供模板相关规则；全局 ignores 必须放在数组第一项的无 files config 里（soybean 自带的 ignores 带 files 不生效，会误扫 `out/`）
  - 两套规则都要求模板组件标签 PascalCase（`VBtn` 而非 `v-btn`）、语句带分号——由 `oxfmt`（`.oxfmtrc.json`）负责格式化，`pnpm fmt` 一键执行
- 提交前：`pnpm typecheck` 与 `pnpm lint` 必须通过（注意 `noUnusedLocals`/`noUnusedParameters` 已开启）。

## 部署 / 打包

`pnpm build` 只产出 `packages/desktop/out/`（编译产物）。目前**没有配置 electron-builder 等打包工具**，也没有发布流程；需要分发安装包时需先引入打包配置。
