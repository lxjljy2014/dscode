# 首次启动 API Key 引导页设计

> 日期：2026-08-13 · 状态：已批准（v2 简化版）

## 背景与需求

DSCode 目前是纯 mock 骨架，尚无任何 API key 相关代码。本次新增**首次启动引导页**，引导用户输入 DeepSeek API key：

- 极简交互：**一个 API Key 输入框 + 两个按钮**（开始使用 / 稍后再说），默认 DeepSeek 直连（baseURL `https://api.deepseek.com` 与预置模型 `deepseek-chat` / `deepseek-reasoner` 写死在预置项，页面上不可编辑）。
- 时机：未完成引导时启动进入引导页；完成/跳过后不再出现；设置页「引导」版块可随时修改 key。
- 存储：沿用 `settings.json` 明文持久化（preload / `ipc.ts` / `host.ts` 的 patch 透传链路无需改动）。
- 范围：仅收集存储；ChatInput 硬编码模型列表不动；不做 key 在线校验；不做 safeStorage 加密（后续可迁移）。

## 数据模型

`packages/shared/src/types/settings.ts`：

```ts
export interface ProviderConfig {
  id: string;        // 唯一标识（预置 'deepseek'）
  name: string;      // 供应商显示名
  baseUrl: string;   // OpenAI 兼容接口地址
  apiKey: string;    // 明文存储（原型阶段）
  models: string[];  // 模型列表（预置默认值）
}

export interface AppSettings {
  workingDirectory: string;
  permissionMode: PermissionMode;
  providers: ProviderConfig[];  // 新增（当前只会有一条 deepseek 记录）
  onboardingDone: boolean;      // 新增：完成/跳过引导后为 true
}

export const DEEPSEEK_PRESET: ProviderConfig = {
  id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com',
  apiKey: '', models: ['deepseek-chat', 'deepseek-reasoner']
};
```

UI 只暴露单个 DeepSeek key 输入；`providers` 保持数组结构，为后续多供应商扩展留余地（按用户要求本轮不做多供应商/模型编辑 UI）。

## 持久化（`packages/desktop/src/main/config.ts`）

- `defaultSettings` 增加 `providers: []`、`onboardingDone: false`。
- 新增 `isProviderConfig` 收窄函数；`loadSettings` 对 providers 逐项过滤、onboardingDone 布尔校验，非法回退默认。
- `saveSettings` 白名单合并：providers 校验过滤后整体替换，onboardingDone 仅接受 boolean。

## 状态（`packages/ui/src/stores/settings.ts`）

- `DEFAULTS` 同步新增两个字段。
- `load()` 增加 in-flight Promise 去重；纯浏览器环境（`!host`）置 `loaded=true` 且 `onboardingDone=true`（无持久化时跳过引导）。

## 路由与守卫（`packages/desktop/src/renderer/src/router.ts`）

- 新增顶层路由 `/onboarding` → `OnboardingView`。
- settings children 新增 `:section(onboarding)`（自定义参数正则，只匹配字面量 onboarding，保证 `SettingsView` 标题与侧栏高亮无需特判）→ `SettingsProviders`。
- 新增 `beforeEach` 守卫：`await settingsStore.load()` 后，目标非 onboarding 且 `!onboardingDone` → 重定向 `/onboarding`。

## 组件（`packages/ui/src/components/`）

1. **`OnboardingView.vue`** —— 全屏引导页：`.ds-drag` 标题栏拖拽区（macOS 让位 84px）+ 居中列 `max-w-120` + Logo（`i-lucide:sparkles`）+ 标题「连接 DeepSeek」+ 一个 API Key 输入框（password/text 切换）+ 两个按钮。挂载时预填已保存的 key；「开始使用」（key 为空时禁用）→ `save({ providers: [{...DEEPSEEK_PRESET, apiKey}], onboardingDone: true })` → `replace('/')`；「稍后再说」→ `save({ onboardingDone: true })` → `replace('/')`。
2. **`SettingsProviders.vue`** —— 设置页「引导」版块：单张 VCard（DeepSeek API Key 标签 + 保存按钮 + key 输入框），保存时同样写回 deepseek 预置项。

## i18n

`zh-CN.json` / `en-US.json` 同步 `onboarding` 命名空间：`title`（连接 DeepSeek / Connect DeepSeek）、`deepseekApiKey`、`apiKey`、`apiKeyPlaceholder`、`start`、`skip`。设置页版块标题复用已有 `settingsPage.section.onboarding`，保存按钮复用 `settingsPage.save`。

## 验证

`pnpm typecheck` + `pnpm lint` 必须通过；浏览器模式 GUI 复验 + Electron 实机验证（首启重定向、落盘、重启不弹、跳过）。
