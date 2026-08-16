export * from './types';
export * from './openai-compatible';
export * from './deepseek';
export * from './stream';
export * from './retry';

import { deepseekAdapter } from './deepseek';
import { openAiCompatibleAdapter } from './openai-compatible';
import type { ModelAdapter } from './types';

/**
 * 适配器注册表：新增供应商适配器在此登记一行。
 * 供应商 settings.providers[].adapter 指定适配器 id；未指定或未知名回退 OpenAI 兼容默认。
 */
const ADAPTERS: ModelAdapter[] = [openAiCompatibleAdapter, deepseekAdapter];
const adaptersById = new Map(ADAPTERS.map(a => [a.id, a]));

export function resolveAdapter(id: string | undefined): ModelAdapter {
  return (id ? adaptersById.get(id) : undefined) ?? openAiCompatibleAdapter;
}
