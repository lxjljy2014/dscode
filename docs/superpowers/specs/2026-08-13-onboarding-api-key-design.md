# 首次启动 API Key 引导页设计

> 日期：2026-08-13 · 状态：已批准（v3：验证式单按钮版）

## 背景与需求

DSCode 目前是纯 mock 骨架，尚无任何 API key 相关代码。本次新增**首次启动引导页**，引导用户配置 DeepSeek API key：

- 极简交互：Logo + 标题「欢迎使用 DSCode」+ 一个 API Key 输入框（outlined 圆角、无 label、eye 切换）+ 全宽按钮「验证并开始使用」+ 次要按钮「稍后配置」（只置 onboardingDone，不保存半填写 key）；页脚两行：如何获取 API Key（外链）与「Key 仅保存在本地，不会上传」。
- **真实校验**：点击按钮时经主进程 `GET https://api.deepseek.com/models`（Bearer）校验 key——401/403 视为无效，其余失败视为网络异常；校验通过才保存并进入工作区。
- 时机：未完成引导时启动进入引导页；完成后不再出现；设置页「引导」版块可随时修改 key。
- 存储：沿用 `settings.json` 明文持久化。
- 范围：仅收集存储与校验；ChatInput 硬编码模型列表不动；不做 safeStorage 加密（后续可迁移）。

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
  onboardingDone: boolean;      // 新增：验证保存后为 true
}

export const DEEPSEEK_PRESET: ProviderConfig = {
  id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com',
  apiKey: '', models: ['deepseek-chat', 'deepseek-reasoner']
};

export type ProviderVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'unauthorized' | 'network' | 'invalid-args' };
```

UI 只暴露单个 DeepSeek key 输入；`providers` 保持数组结构，为后续多供应商扩展留余地。

## 持久化与校验

- `main/config.ts`：defaults 增加 `providers: []`、`onboardingDone: false`；`isProviderConfig` 收窄；load 过滤校验、save 白名单合并。
- `main/provider.ts`（新增）：`verifyProvider(baseUrl, apiKey)` —— 仅 https、URL 规范化后请求 `{baseUrl}/models`，10s 超时，200 通过 / 401·403 无效 / 其余与异常归网络失败。
- `main/ipc.ts`：注册 `provider:verify`（withMainWindow + 类型校验）；preload 暴露 `verifyProvider`；`host.ts` 类型同步。

## 状态 / 路由 / 组件

- `stores/settings.ts`：DEFAULTS 同步新字段；`load()` in-flight 去重；纯浏览器环境置 `onboardingDone=true`（跳过引导）。
- `router.ts`：`/onboarding` 路由 + settings 子路由 `:section(onboarding)`（自定义参数正则，标题/高亮无需特判）+ `beforeEach` 守卫（未完成引导一律重定向 onboarding）。
- `OnboardingView.vue`：居中列 `max-w-120`（`.ds-drag` 拖拽区）；VTextField 用普通 div 包裹防 flex 拉伸；按钮 `:loading` 校验中、空 key 禁用；错误经 VTextField `error-messages` 展示，编辑 key 时清除旧错误；「稍后配置」只置 onboardingDone；「如何获取 API Key？」走 `<a target="_blank">` → `setWindowOpenHandler` → `shell.openExternal` 既有外链链路。
- `SettingsProviders.vue`：设置页「引导」版块（单 key 表单 + 保存，无校验）。

## i18n / 验证

- `onboarding` 命名空间：title / subtitle / deepseekApiKey / apiKey / apiKeyPlaceholder / start / howTo / localOnly / verifyInvalid / verifyFailed。
- `pnpm typecheck` + `pnpm lint` 必须通过；浏览器模式 GUI 复验 + Electron 实机验证（首启重定向、无效 key 负向校验、落盘、重启不弹）。
