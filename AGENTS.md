# AGENTS.md

> 面向 AI 编码代理的项目说明。假设读者对本项目一无所知。

## 项目概览

**DSCode** 是一个 AI 编程助手的桌面端应用骨架（类似 coding agent 的 GUI 客户端），基于 **Electron + Vue 3 + TypeScript**。当前处于早期原型阶段：界面完整，但数据全部为前端 mock（会话、diff、文件树均来自 `packages/shared/src/mock`），尚未接入真实后端或 agent 能力。

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
│       ├── main/     # Electron 主进程（窗口创建、Windows 标题栏悬浮按钮 IPC）
│       ├── preload/  # contextBridge 暴露 window.dscode
│       └── renderer/ # Vue 应用入口（App.vue / router.ts / main.ts）
├── shared/           # @dscode/shared —— 纯 TS：类型定义、mock 数据、i18n 语言包
│   └── src/
│       ├── types/    # Session / Message / DiffFile / FileNode 等类型
│       ├── mock/     # mockSessions / mockDiffFiles / mockFileTree
│       └── locales/  # zh-CN.json / en-US.json
└── ui/               # @dscode/ui —— 全部 UI：组件、Pinia stores、插件、主题
    └── src/
        ├── components/  # 17 个 Vue SFC（WorkspaceView、ChatView、DiffPanel 等）
        ├── stores/      # ui.ts（主题/语言/侧栏显隐）、session.ts（会话/流式回复模拟）
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

`pnpm-workspace.yaml` 里的 `allowBuilds` / `onlyBuiltDependencies` 是 pnpm 11 的依赖构建白名单：**新增带 postinstall 的原生依赖必须在此登记，否则其 build scripts 不会执行**；`minimumReleaseAgeExclude` 用于绕过 electron 的发布年龄检查（目前登记了 `electron@43.4.0`）。

## 代码约定

- **注释与文档使用中文**（项目现有注释均为中文，git commit 也是中文）。标识符用英文。
- Vue 组件一律 `<script setup lang="ts">`；样式优先用 UnoCSS 工具类写在 `class` 里，配合 Vuetify 组件 props，基本不写 `<style>` 块。
- 图标用 UnoCSS 图标语法：`i-lucide:xxx`（已按 Vuetify 官方文档集成 Lucide iconset）。
- 文案一律走 i18n：key 加到 `packages/shared/src/locales/zh-CN.json` 和 `en-US.json` 两个文件，组件里 `t('xxx')`。
- 可复用 UI 放 `packages/ui`（并在 `src/index.ts` 导出），Electron 宿主相关的薄壳代码放 `packages/desktop`。`TerminalPanel` 是个例外：它未被 `index.ts` 导出，由 `WorkspaceView` 相对路径直接引用。
- 跨包引用用包名（`@dscode/shared`、`@dscode/ui`、`@dscode/ui/tokens`），TS 路径别名在根 `tsconfig.base.json` 配置；渲染进程内部还有 `@renderer` 别名指向 `packages/desktop/src/renderer/src`。

## 主题系统（改动前必读）

颜色的**唯一事实源**是 `packages/ui/src/theme/tokens.ts`：

1. `neutral` 中性色阶 → 2. Vuetify `lightTheme`/`darkTheme` 语义色 → 3. Vuetify 生成 `--v-theme-*` CSS 变量 → 4. `unoColors` 把这些变量映射为 UnoCSS 颜色类（`bg-surface`、`text-muted`、`border-line` 等）。

**不要**在组件里写死颜色值；新增颜色时按上述链路添加。UnoCSS 关闭了 reset 预检（避免与 Vuetify reset 冲突），图标 preset 删掉了 color 属性（Vuetify 要求），详见 `packages/desktop/uno.config.ts` 注释。

## Electron 主进程要点

- 无边框窗口（`titleBarStyle: 'hidden'`）：macOS 用 `trafficLightPosition` 悬浮红绿灯，Windows 用 `titleBarOverlay` 原生悬浮按钮（配色透明，渲染端主题切换时经 IPC `win:set-titlebar-overlay` 同步）。渲染端需为系统控件预留位置，相关常量在 `@dscode/ui` 的 `host.ts`（`TITLEBAR_OVERLAY_WIDTH = 150`，macOS 左侧让位 84px）。
- 渲染端通过 `.ds-drag` / `.ds-no-drag` CSS 类处理标题栏拖拽区（见 `global.css`）。
- 安全设置：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`；外部链接一律 `shell.openExternal`，`window.open` 被 deny。
- preload 只暴露 `window.dscode`（platform、versions、setTitleBarOverlay）；纯浏览器环境下为 `undefined`，组件须降级处理。

## 测试与质量

- 无单元测试 / E2E 测试设施。若引入测试，需自行选型并在本节补充说明。
- **lint 双轨并存**（配置都在仓库根）：
  - `oxlint`（`.oxlintrc.json`）：Rust 实现、毫秒级；内置 vue 插件 lint `.vue` 的 `<script>` 块（模板规则暂缺，官方语言插件路线图中）；自动读取 `.gitignore` 排除产物
  - `eslint`（`eslint.config.js`，flat config，基于 `@soybeanjs/eslint-config-vue`）：全量 Vue 规则含模板；全局 ignores 必须放在数组第一项的无 files config 里（soybean 自带的 ignores 带 files 不生效，会误扫 `out/`）
  - 两套规则都要求模板组件标签 PascalCase（`VBtn` 而非 `v-btn`）、语句带分号——由 `oxfmt`（`.oxfmtrc.json`）负责格式化，`pnpm fmt` 一键执行
- 提交前：`pnpm typecheck` 与 `pnpm lint` 必须通过（注意 `noUnusedLocals`/`noUnusedParameters` 已开启）。

## 部署 / 打包

`pnpm build` 只产出 `packages/desktop/out/`（编译产物）。目前**没有配置 electron-builder 等打包工具**，也没有发布流程；需要分发安装包时需先引入打包配置。
