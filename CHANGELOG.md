# 更新日志

## 0.2.0（2026-08-21）

本版重点：MCP 工具接入、子智能体委派、自定义模型供应商，以及启动与工具能力的全面增强。

### 🎉 新功能

- **MCP 工具闭环**：配置的 MCP 服务器（stdio）工具以 `mcp__<server>__<tool>` 命名合入 agent 工具表，模型可直接调用（长连接池 + 30 分钟空闲回收，外部工具默认走写确认门控）；JSON Schema 自动映射为工具参数，复杂嵌套降级透传。
- **子智能体委派（task 工具）**：主 agent 可派发独立上下文的子任务（单父运行上限 5 个），结论摘要回传；默认只读白名单（read_file / list_dir / search / browse），改动计入父会话 diff。
- **子智能体可写（writable）**：借鉴官方 harness 的「继承 + 冻结」权限模型——writable 开启时工具面按父权限模式收敛（confirm 模式下仍只读，可见性即执行性），可写子任务的文件改动由父会话全量 diff 捡漏。
- **自定义模型供应商**：设置页可添加任意 OpenAI 兼容接口（第三方中转 / OpenRouter / 本地 Ollama、LM Studio），预置 9 家厂商一键填入；「验证并拉取模型」连通即拉取模型列表（http 仅放行本机回环地址，SSRF 防护不变）。
- **模型设置页重做**：左右栏布局（VList 导航 + 编辑/添加视图），厂商官方 logo（simple-icons / lobehub 图源，随包内置），当前在用供应商标绿；当前使用的模型提升为全局共享状态。
- **read_file 行分页**：`offset` / `limit` 参数 + `totalLines` / `hasMore` 元信息，大文件按页读取（默认 500 行）。
- **search 增强**：正则模式、文件过滤（`include`，支持 `*.ts` / `ts,tsx`）、每文件命中上限；跳过目录扩充（build / target / venv / __pycache__ 等十余项）。
- **diff 面板升级**：统一 / 并排视图切换、diff 行语法高亮（按扩展名映射语言）、提交时文件勾选（默认全选，只提交勾选路径）。
- **文件树右键操作**：新建文件 / 新建文件夹 / 重命名 / 删除（移入系统回收站，非永久删除），操作后自动刷新。

### ⚡ 性能与稳定性

- 启动提速：splash 最短展示 3000ms → 600ms；旧会话迁移与回填移出首窗关键路径。
- 单实例锁：重复启动聚焦已有主窗口，不再多开。
- 会话缓存 LRU 淘汰：runtime 审批/统计 Map 与 persist 目录缓存设上限（64 会话），归档会话即时清理。
- UI 文件内容缓存上限 32 文件（保留当前选中）。

### 🐛 修复

- **release CI 构建失败**：electron-builder 在 CI 环境默认尝试自动发布而 workflow 无 token，显式 `--publish never`（本工作流由 publish job 汇总发布）；publish 改用 Actions 内置 token。
- SettingsProviders 保存自定义供应商时覆盖已有列表的问题。

### 🛠 工程

- 单测扩展至 **319 个**（core 263 + desktop 32 + ui 24），新增 ui 纯逻辑测试基建（diff / markdown / settings store / workspace store）。
- 模型页交互组件全面 Vuetify 化（VListItem / VItemGroup + VCard），裸 button 手搓样式退场。

### ⚠️ 已知问题

- 安装包**未签名**：macOS Gatekeeper / Windows SmartScreen 会提示「未知开发者」，需手动放行（mac 自动更新依赖签名，暂不可用）。
- 回滚快照与 diff 面板均为应用生命周期内瞬态（重启后不可回滚）。

### 📦 安装

- **Windows**（x64）：`DSCode-0.2.0-win-x64-setup.exe`
- **macOS**（Intel / Apple Silicon）：`DSCode-0.2.0-mac-x64.dmg` / `DSCode-0.2.0-mac-arm64.dmg`

## 0.1.3（2026-08-20）

本版重点：agent 改动的安全网（回滚 / 定向提交）与上下文自动压缩，另修复 /compact 一批可用性问题。

### 🎉 新功能

- **回滚 agent 文件改动**：变更面板新增「恢复到运行前」——把修改/删除的文件写回运行开始前的原文、删除运行期间新增的文件（带确认对话框）。快照在运行结束后保留（最多 8 个会话），应用重启后丢失（与 diff 面板的瞬态语义一致）。
- **定向提交改动**：变更面板新增「提交」——输入提交信息后只提交 diff 列出的路径（`git add + git commit -- <paths>`），不动用户暂存区里的无关内容；提交成功后放弃快照、变更面板清空。
- **上下文压力自动压缩**：运行结束时若上下文占用达到阈值（按所属供应商的上下文窗口计算，默认 80%），自动压缩较旧的对话历史。可在「设置 → 常规」开关并调整阈值（50–95%）。

### 🐛 修复

- **/compact 可用性修复**：命令卡片场景下 Enter 直接执行动作命令（此前第一次回车只补一个不可见的尾随空格，看起来像没反应）；action 命令提交后立即清空输入框；压缩进行中在会话流末尾显示「正在压缩对话历史…」状态行。
- **压缩后滚动跳顶**：压缩替换整个消息数组导致长度不变（如 4→4）时滚动贴底失效，现强制吸底。
- **压缩后上下文计量即时回落**：压缩完成同步计算新的上下文投影（渲染端立即更新 + 主进程持久化锚定，下次运行不虚高）。

### 🛠 工程

- 单测扩展至 **253 个**（core 221 + desktop 32），新增快照回滚 / 定向提交 / autoCompact 阈值归一化覆盖。
- 工具批调度（并行滚动池 + 独占屏障 + 模型顺序提交）与请求重试（指数退避）落地并补录文档。

### ⚠️ 已知问题

- 安装包**未签名**：macOS Gatekeeper / Windows SmartScreen 会提示「未知开发者」，需手动放行（mac 自动更新依赖签名，暂不可用）。
- 回滚快照与 diff 面板均为应用生命周期内瞬态（重启后不可回滚）；跨多次运行的累计回滚暂不支持。

### 📦 安装

- **Windows**（x64）：`DSCode-0.1.3-win-x64-setup.exe`
- **macOS**（Intel / Apple Silicon）：`DSCode-0.1.3-mac-x64.dmg` / `DSCode-0.1.3-mac-arm64.dmg`

## 0.1.2（2026-08-19）

桌面端 AI 编程助手。本版重点：对话历史压缩、上下文占用实时可视化，以及一批安全与稳定性加固。

### 🎉 新功能

- **`/compact` 命令**：一键压缩对话历史，把较早消息摘要为检查点、只保留最近 3 条消息，显著释放上下文；旧 `builtin-compact` 模板命令自动迁移为新的 `action` 命令。
- **上下文占用实时投影**：基于「锚定投影」token 计数（对 provider 精确 `promptTokens` 锚定 + 增量估算），统计条实时显示 context / system / tools / messages 的 token 占用。
- **会话滚动接管 + 回到底部按钮**：滚动历史时不再强制贴底，右下角新增圆形「回到底部」按钮（固定在输入卡片右上方）。
- **主进程原生 UI 双语**：系统托盘、更新提示、系统提示词随系统语言自动切换中/英文。
- **LLM 回复缓存**：相同请求命中缓存直接重放、不调 API，节省 token 成本。

### 🔒 安全加固

- **SSRF 防护**：浏览器工具与供应商校验统一判定私有地址，覆盖 `::ffff:` 映射、末尾点、十进制/十六进制/八进制 IP 归一化。
- **浏览工具加固**：重定向逐跳 `redirect: 'manual'` 重校验、流式响应 2MB 上限、30s 超时。
- **附件读取白名单**：`attachment:read` 仅允许已授权路径。
- **IPC 参数校验**：`settings:set`、`mcp:list-tools`、会话统计等入参严格收窄。
- **`edit_file` 注入修复**：`$&` / `$$` / `$'` 等替换符不再被展开。
- **`run_code` 沙箱加固**：禁用动态代码生成、冻结沙箱、收窄控制台转发。

### 🐛 修复与稳定性

- 流式 SSE 末尾补丁（tail flush）；一旦发出增量即不再重试，避免重复输出。
- 会话持久化改为 O(1) 追加去重；配置写入原子化（防半写损坏）。
- 修复 IPC 未捕获异常、更新器/托盘竞态、设置页若干死按钮。
- `onAgentContext` 桥接缺失时降级跳过，避免旧 preload 下 Diff 面板崩溃。

### 🌐 国际化

- 默认语言跟随系统，`languagechange` 实时切换；文件类型图标/颜色单一事实源；主进程 UI 双语化。

### 🛠 工程

- 单测扩展至 **245 个**（core 213 + desktop 32），新增 SSRF / edit-file / stream / compact / git / workspace / provider / attachment / validators 覆盖。
- Vuetify 升级至 4.1.10。
- 新增 `release` 工作流：tag 推送自动构建 mac（dmg+zip，x64+arm64）与 win（nsis x64）并发布 GitHub Release。

### ⚠️ 已知问题

- 安装包**未签名**：macOS Gatekeeper / Windows SmartScreen 会提示「未知开发者」，需手动放行。
- 自动压缩（上下文压力阈值触发）尚未上线，`/compact` 目前为手动触发。

### 📦 安装

- **Windows**（x64）：`DSCode-0.1.2-win-x64-setup.exe`
- **macOS**（Intel / Apple Silicon）：`DSCode-0.1.2-mac-x64.dmg` / `DSCode-0.1.2-mac-arm64.dmg`
