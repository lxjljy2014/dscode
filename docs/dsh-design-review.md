# DSH 设计剖析与 DSCode 借鉴落地

> 目的：理解 DeepSeek 官方 Harness（.tmp-deepseek-harness）的核心设计，并筛选高价值、低风险的亮点落地到 DSCode。
> 重点借鉴方向：工具调用（tool-calls）、agent 循环（loop）。

## 一、DSH 概览

DeepSeek Harness 是 DeepSeek 官方的 agent 运行时，基于 vendored Cordis（插件容器）构建，「一切皆插件」。
核心包在 packages/core/：agent（Agent 接口/事件）、agent-loop（ReactLoopAgent 驱动）、tools（工具注册表与执行管线）、system-prompt（系统提示词分节注册）、session（事件日志模型）。

## 二、DSH 的 Loop 设计（agent-loop/agent.ts）

### 2.1 turn / step 双层边界
- **turn**：一次用户请求的完整处理轮次（turn/start → 若干 step → turn/end）。
- **step**：一次「模型调用 + 工具执行」的原子单元。每个 step 内：模型流式返回（assistant/chunk）→ 若有工具调用则执行（tool/call / tool/result）→ 结果回传后继续下一个 step；无工具调用则 step 结束（completed）。
- 好处：错误定位精确到 turn/step；max-tokens 截断是「sticky」的（后续正常 step 不降级）；取消/重试语义清晰。

### 2.2 Inbox（next-turn / next-step 双队列）
- followup() 进 next-turn（新的一轮）；steer() 进 next-step（本轮下一步边界）；inject() 进 next-step 但不唤醒驱动。
- 工具结果上下文也经 inbox.splice('next-step', ...) 注入下一步。
- 全部 agent/inbox/spliced 事件持久化，可重放恢复（session log 是唯一事实源）。

### 2.3 会话事件日志（session log）
- 一切模型可见内容都来自持久化事件（turn/start、step/start、user/message、assistant/chunk、assistant/message、tool/call、tool/result、turn/end），请求级配置（request/header）也落日志——「模型可见 ⟺ 已记录」。
- 断点续跑（resume）只需重放日志，不需要额外状态。

### 2.4 错误结构化
- LlmError 保留失败事实（code + message）；未知错误 flatten 为 { message, code: 'UNKNOWN' }，杜绝把未知异常伪装成网络错误。
- agent/request-error 是重试扩展点（llm-retry 插件挂在这里）。

### 2.5 扩展点全部走事件
agent/pre-step（改写/拒绝进入 step 的消息）、agent/request（改写请求配置）、agent/request-error（重试决策）、agent/turn-stopping（关停边界）都是 Cordis 事件，插件无需改 loop 本体。

## 三、DSH 的工具调用设计（tool-calls.ts + tools/index.ts）

### 3.1 并行 / 独占调度
- 每个工具可选 isConcurrencySafe(args) 分类器：并行安全（只读/无副作用）声明 parallel，其余默认 exclusive。
- executeToolCalls 按模型顺序遍历：exclusive 单独执行形成 barrier；parallel 用有界滚动池（maxParallelToolCalls，默认 4）并行执行。
- **结果按模型顺序提交**：commitReady 只推进连续已完成的槽位，保证上下文/事件顺序与模型调用顺序一致（对前缀缓存稳定至关重要）。
- abort 时：已启动的调用排干并提交，未启动的补合成错误结果（TOOL_ABORTED_BEFORE_DISPATCH），保证日志完整可重放。

### 3.2 工具 schema DSL（schema.ts）
- ValueSchemaSpec（类型安全的 schema 对象）→ 编译为 JSON Schema；类型推断 InferArgs<S> 让 execute(args: InferArgs<S>, ...) 参数类型安全。
- 执行前 validateArgs 校验，非法参数抛 ToolArgsError（错误信息给模型，模型可据此修正）。
- 输出也声明 schema 并校验，render() 纯函数把规范化结果投影为模型内容。

### 3.3 执行管线（pre → guard → execute → post → finalize → result）
- tools/pre-execute（审批 waterfall，可 allow/deny/ask）、tools/execute（around 包装，可加超时/重试）、tools/post-execute（改写结果）、tools/result（观察）。
- 每个工具可声明 timeoutMs（合作式超时）与 presentCall/presentResult（UI 呈现意图，纯函数、可重放）。

## 四、DSCode 现状与差距

| 维度 | DSH | DSCode（改造前） |
| ---- | ---- | ---- |
| 循环边界 | turn/step 双层，事件日志持久化 | 单一 round 计数，消息在内存数组累积 |
| 工具执行 | 并行滚动池 + 独占 barrier + 模型顺序提交 | 串行 for 逐个 await |
| 参数校验 | schema DSL + ToolArgsError | 各工具内部 strArg 手写检查，文案不统一 |
| 超时 | timeoutMs 合作式 | run_command 硬编码 60s，其余无 |
| 请求重试 | llm-retry 指数退避 + jitter + retryable codes | 无（失败即报错） |
| 错误 | LlmError 结构化 | ApiError/timeout/unknown 三类 |
| 系统提示词 | 分节注册 + 变量 + 动态上下文 | 单一字符串可整体覆盖 |

## 五、本次落地（借鉴亮点 → DSCode 实现）

### 5.1 工具层（packages/core/src/tools/）
- Tool 接口新增：concurrency?: 'parallel' | 'exclusive'（缺省 exclusive）、timeoutMs?、execute 的 ctx.signal。
- validateArgs()：按 parameters schema 校验 required + 基础类型，executeTool 执行前统一校验，错误文案结构化（参数错误: 缺少参数 path）。
- 读类工具（read_file/list_dir/search/browse）声明 parallel；写/执行类保持 exclusive。
- 超时以 AbortSignal.timeout 合成，中止时错误信息区分「超时/中止」。

### 5.2 运行时调度（packages/core/src/agent/tool-batch.ts，新增）
- executeToolBatch：门控阶段串行（确认卡片一次一个），执行阶段按并发分类调度——parallel 连续段并行（上限 4），exclusive 形成 barrier。
- **结果按模型调用顺序提交**（事件 + 上下文），保证渲染端 steps 落库顺序与运行时上下文一致，前缀缓存不漂移。
- 顺带修复原缺陷：plan 模式原实现因 needsConfirm 返回 false 而绕过 gateTool 直接执行写工具；现统一走 gateTool，plan 模式真正拒绝写/执行。

### 5.3 请求重试（packages/core/src/adapters/retry.ts，新增）
- streamChatWithRetry：仅对瞬时故障重试（HTTP 429/5xx、网络层错误），指数退避 + jitter 封顶 8s，最多 2 次重试；中止/超时不重试。
- 可取消退避（signal 中止立即停止等待）。

## 六、未落地（DSH 更深的架构，留待后续）

- **turn/step 双层 + 会话事件日志**：DSCode 已有渲染端 steps 落库 + 跨运行前缀稳定设计；全面引入 session log 事件溯源（含 resume 重放）是架构级改造，本轮未动。
- **Inbox steer/inject**：运行中注入/转向需要 UI 配合，暂未实现。
- **插件系统（Cordis）**：DSCode 为纯 TS 内核 + 宿主壳，未引入插件容器；当前以「编译期注册表 + 事件回调」满足需求。
- **工具 schema DSL 与 UI 呈现意图**：presentCall/presentResult 需要 UI 渲染层配合，后续按需引入。

## 七、测试覆盖

- test/tools-validation.test.ts：validateArgs 规则、并发分类、executeTool 校验/未知工具。
- test/tool-batch.test.ts：并行调度模型顺序提交、exclusive barrier、plan 拒绝、中止短路。
- test/retry.test.ts：可重试错误分类、指数退避 + jitter 范围。
