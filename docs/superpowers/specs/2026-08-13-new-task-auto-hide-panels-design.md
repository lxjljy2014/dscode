# 新建任务时自动隐藏右侧面板与终端 — 设计文档

日期：2026-08-13
状态：已确认（方案 A）

## 背景

当前点击「新建任务」后，右侧 diff 面板与底部终端保持原有显隐状态。用户希望新建任务时聚焦对话区，自动收起这两块面板。

## 现状

- 新建任务入口共三处，均调用 `session.ts` 的 `createSession()`：
  - `SessionSidebar.vue` 项目栏 `+` 按钮
  - `WorkspaceSidebar.vue`「新建任务」列表项
  - `WorkspaceSidebar.vue` 全局快捷键 Ctrl/Cmd+N
- 面板显隐由 `ui.ts` 的 `rightVisible` / `terminalVisible` 驱动（`WorkspacePanel` / `TerminalPanel` 的 `VNavigationDrawer` v-model）；两者不持久化，每次启动默认隐藏。

## 决策

- 采用方案 A：在 `createSession()` 内统一收起 —— 一处改动覆盖全部入口（含未来新增入口），不会漏。
- 仅隐藏、不重置：终端标签页与 pty 会话、diff 面板内容、面板尺寸均保留；左侧会话栏不受影响。

## 设计

1. `packages/ui/src/stores/ui.ts` 新增并导出：

```ts
/** 新建任务等场景：收起右侧面板与终端（不重置尺寸与内容） */
function hideSidePanels() {
  rightVisible.value = false;
  terminalVisible.value = false;
}
```

2. `packages/ui/src/stores/session.ts` 的 `createSession()` 末尾调用 `useUiStore().hideSidePanels()`。

   - 跨 store 单向依赖：session → ui（ui 不依赖 session，无循环引用）。
   - `useUiStore()` 在 action 内调用（Pinia 常规做法），而非 setup 顶层，保持 store 惰性初始化。

数据流：任一入口 → `createSession()` → `hideSidePanels()` → 两个抽屉随 v-model 收起。

## 错误处理

纯前端同步状态更新，无异步、无 IPC、无失败路径，无需额外错误处理。

## 验证

项目无测试框架。验证方式：

1. `pnpm typecheck` + `pnpm lint` 通过
2. dev 手动验证：先手动打开右侧面板与终端 → 分别经三个入口新建任务 → 两面板均收起；重新展开后终端内容、面板宽度不变
