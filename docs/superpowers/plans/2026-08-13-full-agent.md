# 完整 Agent 能力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 DSCode 从全 mock 骨架升级为真实 coding agent：LLM 流式对话 + 6 工具循环 + 权限门控 + 真实工作区/diff + 会话持久化 + 模型选择。

**Architecture:** 主进程 agent 运行时（`agent.ts` 循环 + `agent-tools.ts` 工具 + `agent-gate.ts` 门控）+ IPC 事件推流（对齐 `terminal.ts`）；渲染端 session store 订阅事件驱动 UI。

**Tech Stack:** Electron 43 主进程 Node（fetch SSE / node:sqlite / child_process）、Vue 3 + Pinia 3 渲染端、共享 TS 类型在 `@dscode/shared`。

## Global Constraints

- 注释与 git commit 用中文；标识符用英文；文案走 i18n（zh-CN / en-US 两个文件）。
- 模型 `deepseek-v4-pro`；配置由主进程读 settings.json（渲染端不可注入 baseUrl/key）。
- 所有文件路径必须经 `resolveSafePath` 限定在工作目录内。
- 每个 Task 完成后 `pnpm typecheck` + `pnpm lint` 通过才提交（逐 Task 中文提交）。
- 项目无测试框架：验证 = typecheck + lint + dev 手动清单。

---

### Task 1: shared 类型与预置模型

**Files:**
- Modify: `packages/shared/src/types/index.ts`
- Modify: `packages/shared/src/types/settings.ts`
- Modify: `packages/shared/src/mock/`（相关 mock 会话补 `toolEvents: []`）

**Interfaces:**
- Produces: `AgentToolName`、`AgentToolEvent`、`ChatMessagePayload`、`AgentErrorEvent`、`AgentConfirmRequest`、`Message.errorCode?`、`Session.toolEvents`

- [ ] **Step 1: types/index.ts 新增类型**

```ts
/** agent 可调用的工具名 */
export type AgentToolName = 'read_file' | 'list_dir' | 'search' | 'run_command' | 'write_file' | 'edit_file';

/** 工具事件（聊天流中交错展示） */
export interface AgentToolEvent {
  id: string;
  name: AgentToolName;
  /** 参数 JSON 字符串（原样展示） */
  args: string;
  status: 'running' | 'done' | 'error' | 'confirming' | 'denied';
  /** 结果摘要（截断后的开头部分） */
  summary?: string;
  error?: string;
  createdAt: number;
}

/** agent:start 传入的消息历史（渲染端 → 主进程） */
export interface ChatMessagePayload {
  role: 'user' | 'assistant';
  content: string;
}

/** agent:error 事件负载 */
export interface AgentErrorEvent {
  sessionId: string;
  code: 'no-api-key' | 'api' | 'network' | 'aborted' | 'unknown';
  detail?: string;
}

/** agent:confirm 确认请求负载 */
export interface AgentConfirmRequest {
  sessionId: string;
  toolEventId: string;
  name: AgentToolName;
  args: string;
}
```

`Message` 增加 `errorCode?: string`；`Session` 增加 `toolEvents: AgentToolEvent[]`。

- [ ] **Step 2: settings.ts 更新预置模型**

`DEEPSEEK_PRESET.models` 改为 `['deepseek-v4-pro']`。

- [ ] **Step 3: mock 数据补字段**

mockSessions 每个会话补 `toolEvents: []`（即便 store 不再引用，类型检查必须通过）。

- [ ] **Step 4: typecheck + lint + commit**

Run: `pnpm typecheck && pnpm lint`；通过后 `git add packages/shared && git commit -m "feat: shared 新增 agent 工具事件与错误类型，预置模型改 deepseek-v4-pro"`

---

### Task 2: 主进程工具集 agent-tools.ts

**Files:**
- Create: `packages/desktop/src/main/agent-tools.ts`

**Interfaces:**
- Produces: `TOOL_DEFINITIONS`（OpenAI function schema 数组）、`executeTool(name: AgentToolName, argsJson: string, cwd: string): Promise<{ ok: true; content: string } | { ok: false; error: string }>`、`toolPermission(name): 'read' | 'write' | 'execute'`

- [ ] **Step 1: 路径安全与公共常量**

```ts
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist']);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_OUTPUT_CHARS = 24 * 1024;
const MAX_DIR_ENTRIES = 200;
const MAX_SEARCH_HITS = 50;
const LIST_DEPTH = 2;
const COMMAND_TIMEOUT_MS = 60_000;

/** 把工具传的路径限定在工作目录内（防目录穿越） */
export function resolveSafePath(cwd: string, p: string): string | null {
  const resolved = path.resolve(cwd, p);
  const prefix = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
  if (resolved !== cwd && !resolved.startsWith(prefix)) return null;
  return resolved;
}
```

- [ ] **Step 2: TOOL_DEFINITIONS（function schema ×6）**

每个工具 schema 含 `name/description/parameters`；`toolPermission` 返回 `'read' | 'write' | 'execute'`（run_command=execute，write_file/edit_file=write，其余 read）。

- [ ] **Step 3: read_file / list_dir / search 实现**

- read_file：`readFileSync` ≤512KB、按行编号输出 `1\t...`、超 24KB 截断并注明
- list_dir：`readdirSync({ withFileTypes: true })` 递归 2 层、跳 SKIP_DIRS、先目录后文件、超 200 条截断
- search：递归遍历跳 SKIP_DIRS，文件名或内容（UTF-8、≤256KB）不区分大小写 `includes` 匹配，命中输出 `相对路径:行号: 摘录`，最多 50 条

- [ ] **Step 4: run_command 实现**

`execFile(process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL ?? '/bin/sh'), [win32 ? '/c' : '-c', cmd], { cwd, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 4MB })`，拼接 stdout+stderr ≤24KB；超时 kill（`killed: true` + `SIGKILL`）；退出码与输出都返回。

- [ ] **Step 5: write_file / edit_file 实现**

- write_file：目标路径经 resolveSafePath、父目录必须已存在、内容 ≤512KB，`writeFileSync` 覆盖
- edit_file：读原文件，`old_string` 必须恰好出现一次才用 `new_string` 替换（0 次报「未找到」，多次报「匹配不唯一，请提供更多上下文」），写回

- [ ] **Step 6: executeTool 统一入口 + typecheck/lint/commit**

按 name 分发；未知工具返回 `{ok:false,error}`；所有异常捕获转 error。验证后提交 `feat: 主进程新增 agent 工具集（读/列/搜/命令/写/编辑）`

---

### Task 3: 权限门控 agent-gate.ts

**Files:**
- Create: `packages/desktop/src/main/agent-gate.ts`

**Interfaces:**
- Consumes: `toolPermission` from Task 2
- Produces: `gateTool(name: AgentToolName, mode: PermissionMode, confirm: (toolEventId: string, name, argsJson) => Promise<boolean>): Promise<{ allow: boolean; reason?: string }>`

- [ ] **Step 1: 门控决策实现**

只读 → allow；full-access → allow；plan → 写/执行 deny（reason 'plan-mode'）；auto-edit → write allow、execute confirm；confirm → 写/执行 confirm。

- [ ] **Step 2: 确认等待（120s 超时自动拒绝）**

confirm 回调由 agent.ts 提供（发 `agent:confirm` 事件 + 注册一次性 resolver）；gate 里 `Promise.race([confirm(...), timeout(120s → false)])`。

- [ ] **Step 3: typecheck/lint/commit**

提交 `feat: 主进程新增权限门控（四模式 + 确认超时自动拒绝）`

---

### Task 4: agent 循环 agent.ts

**Files:**
- Create: `packages/desktop/src/main/agent.ts`
- Modify: `packages/desktop/src/main/index.ts`（will-quit 挂 `disposeAgents()`）

**Interfaces:**
- Consumes: Task 2 `executeTool`/`toolPermission`、Task 3 `gateTool`、`loadSettings`（config.ts）、Task 7 `recomputeDiff`
- Produces: `startAgent(win, sessionId, model, messages)`、`stopAgent(win, sessionId)`、`disposeAgents()`

- [ ] **Step 1: 会话运行状态与入口**

`Map<sessionId, { controller: AbortController }>`；`startAgent`：读 settings → 无 provider/apiKey 推 `agent:error {code:'no-api-key'}` 返回；创建 controller 注册；异步执行 runLoop；结束后清理。

- [ ] **Step 2: SSE 流式解析**

fetch `POST {baseUrl}/chat/completions`（headers Content-Type/Bearer，body `{ model, messages, tools, stream: true }`，signal）；`res.body.getReader()` + TextDecoder，按 `\n` 切行，`data:` 前缀行 JSON.parse，`[DONE]` 结束。delta：`choices[0].delta.content` 推 `agent:delta`；tool_calls delta（index/id/function.name/function.arguments）按 index 累积。

- [ ] **Step 3: 工具循环（上限 30 轮）**

累积出 tool_calls 后：生成 toolEventId，推 `agent:tool {status:'confirming'|'running'}` → `gateTool`（confirm 回调发 `agent:confirm` 并 await 渲染端响应）→ deny 推 `agent:tool {status:'denied'}` 并把结果以「用户拒绝」回给模型 → allow 执行 `executeTool` → 推 done/error + summary（前 200 字）→ messages 追加 assistant(tool_calls) 与 tool 消息 → 写/执行成功后调 `recomputeDiff(sessionId)` → 继续循环。

- [ ] **Step 4: 收尾与异常**

无工具调用 → `agent:done`；HTTP 非 200 → api error（含 status）；网络/解析异常 → network/unknown；abort → `agent:error {code:'aborted'}`。`stopAgent` abort；`disposeAgents` 全部 abort。

- [ ] **Step 5: typecheck/lint/commit**

提交 `feat: 主进程新增 agent 循环（SSE 流式 + 工具循环 + 门控集成）`

---

### Task 5: IPC + preload + host 类型

**Files:**
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/ui/src/host.ts`

**Interfaces:**
- Produces: host 方法 `agentStart(sessionId, model, messages)`、`agentStop(sessionId)`、`agentConfirmResponse(toolEventId, approve)`、`workspaceTree()`、`workspaceReadFile(path)`、`sessionsList()/sessionsCreate()/sessionsAppend()`、订阅 `onAgentDelta/onAgentTool/onAgentConfirm/onAgentDone/onAgentError/onWorkspaceDiff`

- [ ] **Step 1: ipc.ts 注册全部通道**（invoke 校验参数类型，事件由 agent/workspace 模块经 `win.webContents.send` 发出，此处只注册 invoke 与 confirm-response 中转）

- [ ] **Step 2: preload 暴露方法与订阅**（复制 `onTerminalData` 的字段校验 + 返回退订函数模式）

- [ ] **Step 3: host.ts 补类型**

- [ ] **Step 4: typecheck/lint/commit**

提交 `feat: 打通 agent/workspace/sessions IPC 桥接与渲染端类型`

---

### Task 6: 真实工作区 workspace.ts

**Files:**
- Create: `packages/desktop/src/main/workspace.ts`

**Interfaces:**
- Produces: `scanTree(cwd): Promise<FileNode[]>`、`readWorkspaceFile(cwd, relPath): Promise<{ok:true,content} | {ok:false,error}>`

- [ ] **Step 1: scanTree**（深度 ≤8、跳 SKIP_DIRS、单目录 500 条、目录在前；权限/不存在异常按空节点容错）

- [ ] **Step 2: readWorkspaceFile**（resolveSafePath + ≤512KB + UTF-8）

- [ ] **Step 3: typecheck/lint/commit**

提交 `feat: 主进程新增工作区扫描与文件读取`

---

### Task 7: 真实 diff diff.ts

**Files:**
- Create: `packages/desktop/src/main/diff.ts`

**Interfaces:**
- Produces: `initSnapshot(sessionId, cwd)`、`recomputeDiff(sessionId): DiffFile[]`（经 `workspace:diff` 推渲染端）

- [ ] **Step 1: 快照**（agent 启动时扫描工作目录全部文本文件（≤512KB）存入 `Map<sessionId, Map<path, content>>`）

- [ ] **Step 2: LCS 行级 diff**（两段文本按行 LCS，生成 add/del/context/hunk 的 `DiffLine[]`；新增/删除文件用 `path (新建)` / `path (已删除)` 标记）

- [ ] **Step 3: recomputeDiff**（对比快照与当前内容，收集 DiffFile 列表推 `workspace:diff`）

- [ ] **Step 4: typecheck/lint/commit**

提交 `feat: 主进程新增快照行级 diff 与 workspace:diff 推送`

---

### Task 8: 会话持久化 sessions.ts

**Files:**
- Create: `packages/desktop/src/main/sessions.ts`

**Interfaces:**
- Consumes: shared `Session`/`Message` 类型
- Produces: `initSessions(dbPath)`、`listSessions()`、`createSessionRow(session)`、`appendMessage(sessionId, message)`

- [ ] **Step 1: node:sqlite 建表**（sessions/messages；对齐 projects.ts 的 `DatabaseSync` 用法；启动时 init + CREATE TABLE IF NOT EXISTS）

- [ ] **Step 2: CRUD**（list 按 updated_at 倒序；create upsert；append insert；消息含 error_code 列）

- [ ] **Step 3: typecheck/lint/commit**

提交 `feat: 主进程新增会话 SQLite 持久化`

---

### Task 9: 渲染端 session store 重写

**Files:**
- Modify: `packages/ui/src/stores/session.ts`

**Interfaces:**
- Consumes: host 方法（Task 5）
- Produces: `sendMessage(model)`、`stopGenerating()`、`respondConfirm(toolEventId, approve)`、启动恢复会话

- [ ] **Step 1: 状态改造**（sessions 初始 `[]`、加载 `sessions:list`；无 host 时保留 mock 降级与 mock 初始数据）

- [ ] **Step 2: sendMessage 重写**（host 存在：push user + assistant(streaming) 消息 → `agentStart(sessionId, model, 历史payload)`；历史 = 非 streaming 消息映射 `{role, content}`）

- [ ] **Step 3: 事件订阅**（store 初始化时注册 onAgentDelta/Tool/Confirm/Done/Error/onWorkspaceDiff；按 sessionId 分发；done/error 收尾：streaming=false、errorCode、`sessions:append` 落库、generating=false）

- [ ] **Step 4: stop/confirm**（`stopGenerating` → agentStop；`respondConfirm` → agentConfirmResponse；aborted 场景收尾）

- [ ] **Step 5: typecheck/lint/commit**

提交 `feat: 渲染端 session store 接入真实 agent 事件流`

---

### Task 10: UI 组件

**Files:**
- Create: `packages/ui/src/components/ToolEventCard.vue`
- Modify: `packages/ui/src/components/ChatView.vue`、`MessageItem.vue`、`FileTree.vue`、`DiffPanel.vue`、`ChatInput.vue`

- [ ] **Step 1: ToolEventCard**（紧凑行 + 可展开参数/结果；confirming 显示允许/拒绝按钮调 respondConfirm；状态图标 spinner/check/x/clock）

- [ ] **Step 2: ChatView 交错渲染**（messages 与 toolEvents 按 createdAt 合并排序；MessageItem 渲染 errorCode i18n 文案）

- [ ] **Step 3: FileTree/DiffPanel 接真实数据**（tree 绑 workspaceTree 结果 + 点击 readWorkspaceFile；DiffPanel 绑 onWorkspaceDiff 数据）

- [ ] **Step 4: ChatInput 模型下拉**（绑 providers[0].models，默认 models[0]，选中值随 send 传给 store）

- [ ] **Step 5: typecheck/lint/commit**

提交 `feat: 聊天流工具卡、真实文件树/diff、模型选择 UI`

---

### Task 11: i18n 文案

**Files:**
- Modify: `packages/shared/src/locales/zh-CN.json`、`packages/shared/src/locales/en-US.json`

- [ ] **Step 1: 补齐全部 key**：工具名×6、状态×5（running/done/error/confirming/denied）、允许/拒绝/展开/收起/参数/结果、错误×5（no-api-key/api/network/aborted/unknown + plan-mode）、文件树空态、模型下拉标签

- [ ] **Step 2: typecheck/lint/commit**

提交 `feat: agent 工具与错误文案 i18n（中英）`

---

### Task 12: 文档与最终验证

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: AGENTS.md 更新**（仓库结构补 5 个新模块；业务 IPC 通道清单补 agent:/workspace:/sessions: 通道与事件）

- [ ] **Step 2: 全量 `pnpm typecheck` + `pnpm lint`**

- [ ] **Step 3: dev 手动验证清单**（配 DeepSeek key → 真实对话流式；问「列出项目结构并读取 README 总结」→ 工具卡出现；让 agent 写/改文件 → 确认卡 → diff 面板出 diff；文件树真实；重启应用会话还在；切模型生效；停止按钮中断）

- [ ] **Step 4: 提交** `docs: 补充 agent 架构文档，完成全量验证`

---

## 执行顺序与依赖

Task 1（类型）→ 2/3（工具/门控，可并行）→ 4（循环依赖 2/3）→ 5（IPC，依赖 4/6/7/8 接口）→ 6/7/8（可并行）→ 9（依赖 1/5）→ 10（依赖 9）→ 11 → 12。
