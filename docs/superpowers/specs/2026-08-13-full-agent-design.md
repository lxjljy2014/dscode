# 完整 Agent 能力 — 设计文档

日期：2026-08-13
状态：已确认（全量一期）

## 背景与目标

应用此前全部为前端 mock（会话、diff、文件树、流式回复）。本期把 DSCode 变成真实可用的 coding agent 客户端：真实 LLM 流式对话 + 工具循环（读/写/执行）+ 权限门控 + 真实工作区与 diff + 会话持久化 + 模型选择。

## 已确认决策

- 架构：主进程 agent 运行时 + IPC 事件推流（对齐 `terminal.ts` 既有模式），渲染端 CSP 不允许直连外部 API
- 供应商：settings 中 `providers[0]`（OpenAI 兼容接口，DeepSeek 预置）
- 模型：`deepseek-v4-pro`（deepseek-chat 已下线，`DEEPSEEK_PRESET.models` 同步更新）
- 工具集（6 个）：`read_file` / `list_dir` / `search`（只读）、`run_command`（执行）、`write_file` / `edit_file`（写）
- 权限门控：落实 `PermissionMode` 四种模式语义；confirm 走渲染端确认卡，120s 超时自动拒绝
- 真实工作区：文件树扫描工作目录、文件内容真实读取；agent 修改后基于快照 LCS 行级 diff
- 会话持久化：node:sqlite（sessions + messages 两表）；toolEvents 不持久化
- 模型选择：ChatInput 下拉绑 `settings.providers[0].models`
- 工具卡：聊天流内紧凑卡片可展开；confirming 状态内嵌「允许/拒绝」按钮
- 初始会话：不再使用 mockSessions（真实 agent 下假会话会混淆）

## 架构

### 主进程（packages/desktop/src/main/）

- `agent.ts` —— agent 循环：SSE 流式解析（`data:` 行 + `[DONE]`）、tool_calls 增量累积、工具循环上限 30 轮、每会话 AbortController、`disposeAgents()` 挂 will-quit
- `agent-tools.ts` —— 6 工具实现 + OpenAI function schema + 权限分类（read/write/execute）+ `resolveSafePath` 目录穿越防护
- `agent-gate.ts` —— 门控决策：只读放行 / full-access 全放行 / plan 拒写拒执行 / auto-edit 放写确认执行 / confirm 写执行均确认；确认等待 120s 超时自动拒绝，AbortController 可取消等待
- `workspace.ts` —— `scanTree(cwd)`（深度 ≤8、跳 node_modules/.git/out/dist、单目录 500 条）与 `readWorkspaceFile(cwd, relPath)`（≤512KB）
- `diff.ts` —— 每会话「启动时快照」vs 当前内容，LCS 行级 diff 生成 `DiffLine[]`，经 `workspace:diff` 推给渲染端
- `sessions.ts` —— node:sqlite（对齐 projects.ts），sessions/messages 两表 CRUD

### IPC 通道

- invoke：`agent:start`（sessionId/model/messages，配置由主进程读 settings 防注入）、`agent:stop`、`agent:confirm-response`（toolEventId + approve/deny）、`workspace:tree`、`workspace:read-file`、`sessions:list`、`sessions:create`、`sessions:append`
- 事件（主进程 → 渲染端，按 sessionId 分发）：`agent:delta`（文本增量）、`agent:tool`（工具状态流转）、`agent:confirm`（确认请求）、`agent:done`、`agent:error`（code: no-api-key/api/network/aborted/unknown）、`workspace:diff`（文件变更后的 diff 列表）

### 渲染端

- `session.ts`：sendMessage → `agentStart`；订阅事件分发（delta 追加流式消息、tool 事件入 toolEvents、confirm 推 confirming、done/error 收尾 + 落库）；stop → `agentStop`；`respondConfirm(toolEventId, approve)`；启动时 `sessions:list` 恢复；纯浏览器环境保留 mock 降级
- UI：`ToolEventCard.vue`（紧凑可展开、confirming 内嵌允许/拒绝）、ChatView 按 createdAt 交错渲染 messages 与 toolEvents、MessageItem 按 errorCode 显示 i18n 文案、FileTree/DiffPanel 绑真实数据、ChatInput 模型下拉绑 providers[0].models

## 错误处理

- SSE/网络/HTTP 异常 → `agent:error`（code + detail），渲染端按 code 映射 i18n 文案
- 门控确认超时 120s 自动拒绝，agent 循环不会永久挂起
- API key 缺失 → 启动即报 `no-api-key`，提示到设置页配置
- 工具失败不中断循环：结果以 error 内容回给模型继续

## 非目标

打包分发（无 electron-builder）、单元测试框架（验证 = typecheck + lint + 手动清单）、多窗口、流式内容持久化的增量落库（流式结束后一次性写库）。
