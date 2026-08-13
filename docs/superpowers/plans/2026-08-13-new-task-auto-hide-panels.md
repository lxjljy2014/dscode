# 新建任务自动隐藏右侧面板与终端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建任务时自动收起右侧 diff 面板与底部终端，聚焦对话区。

**Architecture:** 在 `ui` store 新增 `hideSidePanels()` 方法；`session` store 的 `createSession()` 末尾调用它。所有新建任务入口（项目栏 `+`、左侧栏「新建任务」、Ctrl/Cmd+N）都汇到 `createSession()`，一处改动全覆盖。

**Tech Stack:** Vue 3 + Pinia 3（setup 风格 store），纯前端状态同步，无 IPC / 无异步。

## Global Constraints

- 注释与 git commit 用中文；标识符用英文。
- 仅隐藏、不重置：终端标签页与 pty 会话、diff 面板内容、面板尺寸均保留；左侧会话栏不受影响。
- 本改动无新增 UI 文案，不需要动 i18n。
- 改动后 `pnpm typecheck` 与 `pnpm lint` 必须通过（`noUnusedLocals`/`noUnusedParameters` 已开启）。
- 项目无测试框架：验证 = typecheck + lint + dev 手动验证。

---

### Task 1: 新建任务时收起右侧面板与终端

**Files:**
- Modify: `packages/ui/src/stores/ui.ts`
- Modify: `packages/ui/src/stores/session.ts`

**Interfaces:**
- Consumes: `ui.ts` 现有状态 `rightVisible` / `terminalVisible`（ref）。
- Produces: `useUiStore().hideSidePanels(): void` —— 把两个面板可见标志置 false，不重置尺寸与内容。`useSessionStore().createSession()` 保持原签名不变。

- [ ] **Step 1: `ui.ts` 新增 `hideSidePanels`**

在 `packages/ui/src/stores/ui.ts` 的 `toggleTerminal` 函数之后插入：

```ts
  /** 新建任务等场景：收起右侧面板与终端（不重置尺寸与内容） */
  function hideSidePanels() {
    rightVisible.value = false;
    terminalVisible.value = false;
  }
```

- [ ] **Step 2: `ui.ts` 导出 `hideSidePanels`**

在 return 对象中 `toggleRight,` 之后加一行：

```ts
    toggleLeft,
    toggleRight,
    hideSidePanels,
    terminalVisible,
```

- [ ] **Step 3: `session.ts` 引入 ui store**

在 `packages/ui/src/stores/session.ts` 的 import 区（`import type { FileNode, ... }` 之后）加一行：

```ts
import { useUiStore } from './ui';
```

- [ ] **Step 4: `createSession()` 末尾调用**

在 `createSession()` 中 `activeSessionId.value = session.id;` 之后插入（`useUiStore()` 在 action 内调用，保持惰性初始化）：

```ts
    // 新建任务时收起右侧面板与终端，聚焦对话区
    useUiStore().hideSidePanels();
```

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: 无错误输出（exit 0）

- [ ] **Step 6: lint**

Run: `pnpm lint`
Expected: 无错误输出（exit 0）

- [ ] **Step 7: dev 手动验证**

dev 进程已在后台运行（渲染进程改动会 HMR 自动生效）。操作步骤：

1. 点顶栏按钮打开右侧面板、打开终端（并打开一个终端标签页）
2. 点击项目栏 `+` 新建任务 → 右侧面板与终端均收起
3. 重新打开两面板 → 点左侧栏「新建任务」→ 均收起
4. 再打开 → 按 `Ctrl+N` → 均收起
5. 最后重新打开终端与右侧面板，确认终端内容仍在、面板宽度未变

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/stores/ui.ts packages/ui/src/stores/session.ts
git commit -m "feat: 新建任务时自动隐藏右侧面板与终端"
```
