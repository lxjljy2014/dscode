# 项目选择器完善 + Markdown 渲染 — 设计文档

日期：2026-08-13
状态：已确认

## 背景

两个首要任务：
1. 工作空间功能做完整——用户明确指「输入卡牌上面的选择项目」：AppHeader 上的项目选择器是硬编码假菜单（`v-bind` 逻辑写反导致点击无效），应只展示当前工作空间名；输入卡上的选择器搜索框未接过滤。
2. 聊天消息渲染 Markdown——目前 assistant 正文纯文本展示，agent 输出的列表/代码块/表格均为原文。

## 决策

### 任务 1：项目选择器

- AppHeader（有消息时）：删除假 VMenu，改为**只展示当前工作空间**——文件夹图标 + 目录名（basename），悬停 tooltip 显示完整路径；工作空间未选择时显示「选择项目」占位文案。工作空间锁定语义不变（有消息后切换入口只在空会话的输入卡上）。
- ChatInput（空会话时）：搜索框接 `projectKeyword` 状态，按名称 + 路径不区分大小写过滤最近项目；无匹配显示新增 i18n key `project.noMatch`；打开文件夹 / 远程连接占位 / 不在项目中工作保持现状。

### 任务 2：Markdown 渲染（基础 GFM + 语法高亮）

- 新依赖：`markdown-it`（含 `@types/markdown-it`）+ `highlight.js`，安装到 `@dscode/ui`（纯 JS，无 postinstall，不影响 allowBuilds）。
- 新模块 `packages/ui/src/utils/markdown.ts`：单例 markdown-it，`html: false`、`linkify: true`；fence 经 highlight.js 按语言高亮（`highlight.js/lib/common` 子集控制体积），未知语言转义输出。
- 颜色走既有主题链路：tokens.ts 新增 `syntax` 色板（深浅两套：comment/string/number/keyword/function/title/variable/tag/attr/literal/meta + 代码块背景 `syntax-bg`），合并进 lightTheme/darkTheme colors → Vuetify 生成 `--v-theme-syntax-*` 变量；global.css 写 `.ds-md` 排版样式（标题/列表/引用/表格/行内码/代码块/链接）与 `.hljs-*` token 颜色，全部引用主题变量，不写死颜色。
- MessageItem：assistant 正文改 `v-html` 渲染 markdown；思维链与工具结果保持纯文本；用户消息保持气泡纯文本。
- 流式期间逐 chunk 重渲染（原型规模可接受）；链接点击经现有 `will-navigate` 拦截转系统浏览器。

## 验证

- `pnpm typecheck` + `pnpm lint` 通过
- dev 手动：AppHeader 显示当前工作空间名（悬停完整路径）；空会话输入卡搜索过滤生效、无匹配显示文案；agent 回复中的列表/代码块/表格正常渲染、代码高亮正确、链接点击外开
