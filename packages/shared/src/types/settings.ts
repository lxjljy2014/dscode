/**
 * 权限模式（语义对齐参考项目的 configurable-gate）：
 * - confirm（变更前确认）：写/执行类工具发确认请求
 * - auto-edit（自动编辑）：写工具直接放行，执行（bash）仍需确认
 * - plan（计划模式）：写/执行一律拒绝，只读 + 出方案
 * - full-access（完全访问）：全部放行
 * 当前 mock 骨架只持久化该值，真实门控等接入 agent 后实现。
 */
export type PermissionMode = 'confirm' | 'auto-edit' | 'plan' | 'full-access';

/** AI 供应商配置（OpenAI 兼容接口） */
export interface ProviderConfig {
  /** 唯一标识（预置 'deepseek'，自定义用 uuid） */
  id: string;
  /** 供应商显示名 */
  name: string;
  /** 接口地址，如 https://api.deepseek.com */
  baseUrl: string;
  /** API key（明文存储，原型阶段） */
  apiKey: string;
  /** 模型列表（可增删） */
  models: string[];
}

export interface AppSettings {
  /** 工作目录（默认家目录） */
  workingDirectory: string;
  /** 权限模式（默认 confirm） */
  permissionMode: PermissionMode;
  /** AI 供应商配置列表 */
  providers: ProviderConfig[];
  /** 是否已完成引导（完成/跳过后为 true，避免每次启动都弹引导页） */
  onboardingDone: boolean;
}

/** DeepSeek 预置供应商：引导页在 providers 为空时预填（apiKey 留空待用户填写） */
export const DEEPSEEK_PRESET: ProviderConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  models: ['deepseek-chat', 'deepseek-reasoner']
};

/**
 * API key 校验结果（校验请求由主进程发起：渲染端 CSP default-src 'self' 不允许直连外部 API）。
 * unauthorized = key 无效；network = 网络/服务异常；invalid-args = 参数不合法。
 */
export type ProviderVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'unauthorized' | 'network' | 'invalid-args' };

export type SettingsPatch = Partial<AppSettings>;
