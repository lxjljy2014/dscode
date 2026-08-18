# 更新日志

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
