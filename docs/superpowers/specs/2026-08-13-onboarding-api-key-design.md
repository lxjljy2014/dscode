# 首次启动 API Key 引导页设计

> 日期：2026-08-13 · 状态：已批准

## 背景与需求

DSCode 目前是纯 mock 骨架（会话/diff/文件树全部来自 `packages/shared/src/mock`），尚无任何 API key / 凭据相关代码。本次新增**首次启动引导页**，引导用户填写 AI 供应商的 API key：

- 每供应商完整配置：**名称 + baseURL + apiKey + 模型列表（可增删）**；DeepSeek 预置（官方 API `https://api.deepseek.com`，模型 `deepseek-chat` / `deepseek-reasoner`），支持自定义添加其他供应商（OpenAI 兼容）。
- 时机：未完成引导时启动进入引导页；完成/跳过后不再出现；设置页「引导」版块（导航槽位已预留）可随时修改。
- 可跳过：「稍后再说」会记住跳过状态（避免每次启动都弹）。
- 存储：沿用 `settings.json` 明文持久化（preload / `ipc.ts` / `host.ts` 的 patch 透传链路无需改动）。
- 范围：仅收集存储；ChatInput 硬编码模型列表不动；不做 key 在线校验；不做 safeStorage 加密（后续可迁移）。

## 数据模型

`packages/shared/src/types/settings.ts`：

```ts
export interface ProviderConfig {
  id: string;        // 唯一标识（预置 'deepseek'，自定义 uuid）
  name: string;      // 供应商显示名
  baseUrl: string;   // OpenAI 兼容接口地址
  apiKey: string;    // 明文存储（原型阶段）
  models: string[];  // 模型列表（可增删）
}

export interface AppSettings {
  workingDirectory: string;
  permissionMode: PermissionMode;
  providers: ProviderConfig[];  // 新增
  onboardingDone: boolean;      // 新增：完成/跳过引导后为 true
}

export const DEEPSEEK_PRESET: ProviderConfig = {
  id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com',
  apiKey: '', models: ['deepseek-chat', 'deepseek-reasoner']
};
```

`SettingsPatch = Partial<AppSettings>` 自动覆盖新字段。

## 持久化（`packages/desktop/src/main/config.ts`）

- `defaultSettings` 增加 `providers: []`、`onboardingDone: false`。
- 新增 `isProviderConfig` 收窄函数（字段齐全且类型正确）。
- `loadSettings`：providers 逐项过滤、onboardingDone 布尔校验，非法回退默认；旧 settings.json（无新字段）自然得到默认值，老用户也走一次引导。
- `saveSettings`：白名单合并 —— providers 校验过滤后整体替换，onboardingDone 仅接受 boolean。

## 状态（`packages/ui/src/stores/settings.ts`）

- `DEFAULTS` 同步新增两个字段。
- `load()` 增加 in-flight Promise 去重（App.vue 与路由守卫会并发触发）；纯浏览器环境（`!host`）置 `loaded=true` 且 `onboardingDone=true`，跳过引导（无持久化的降级）。

## 路由与守卫（`packages/desktop/src/renderer/src/router.ts`）

- 新增顶层路由 `/onboarding` → `OnboardingView`。
- settings children 在 `:section` 之前插入 `onboarding` 子路由 → `SettingsProviders`（具名路由优先于通配）。
- 新增 `beforeEach` 守卫（当前无守卫）：`await settingsStore.load()` 后，目标非 onboarding 且 `!onboardingDone` → 重定向 `/onboarding`；完成后始终回 `/`（不做 redirect query 回跳）。`useSettingsStore()` 在守卫函数体内调用（main.ts 中 pinia 先于 router 安装）。

## 组件（`packages/ui/src/components/`）

1. **`ProviderEditor.vue`** —— 引导页与设置页复用的核心编辑器。`modelValue: ProviderConfig[]` / `update:modelValue`，持久化由父组件负责。每家一张 `VCard`（`bg-elevated` + `border-line`）：名称、apiKey（password/text + eye 切换）、baseUrl、模型 chips（closable 删除 + 小输入框回车添加，草稿存 `reactive<Record<id, string>>`）；右上删除按钮（直接删除，无确认弹窗）；底部「添加供应商」按钮（`crypto.randomUUID()`）。
2. **`OnboardingView.vue`** —— 全屏引导页：`h-screen` + `.ds-drag` 标题栏拖拽区（无边框窗口，macOS 左侧让位 84px）+ 居中列 `max-w-180` + Logo（`i-lucide:sparkles`）+ 标题/副标题 + 密钥仅存本机说明。挂载时 `await settings.load()`，providers 为空预填 `[DEEPSEEK_PRESET 克隆]`。「开始使用」（无任何供应商 apiKey 非空时 disabled）→ trim 后 `save({ providers, onboardingDone: true })` → `replace('/')`；「稍后再说」→ `save({ onboardingDone: true })`（不保存半填写 providers）→ `replace('/')`。
3. **`SettingsProviders.vue`** —— 设置页「引导」版块：分组 chip + `ProviderEditor` + 「保存」按钮（复用 `settingsPage.save`）→ `settingsStore.save({ providers })`。守卫保证进入设置页前 store 已加载，组件 setup 时同步编辑副本即可。

## 既有文件小改

- `packages/ui/src/index.ts`：导出 `OnboardingView`、`SettingsProviders`。
- `SettingsSidebar.vue`：移除 onboarding 项的 `dashed: true`（版块已实现）。
- `App.vue` 的 `void settingsStore.load()` 保持不变（守卫兜底重定向）。

## i18n

`zh-CN.json` / `en-US.json` 同步新增顶层 `onboarding` 命名空间：`title` / `subtitle` / `securityNote` / `providers` / `providerName` / `providerNamePlaceholder` / `baseUrl` / `apiKey` / `apiKeyPlaceholder` / `models` / `modelPlaceholder` / `addProvider` / `deleteProvider` / `start` / `skip`。设置页版块标题复用已有 `settingsPage.section.onboarding`。

## 验证

`pnpm typecheck` + `pnpm lint` 必须通过；`pnpm dev` 手动验证：首启进引导页 → 填 key 开始使用 → 工作区正常；重启不重复引导；跳过后再启动不弹引导；设置页「引导」版块可增删供应商并持久化；删除全部 key 后重启仍不弹引导（onboardingDone 已置位）。
