/**
 * 文本密度启发式 token 估算（无本地 tokenizer 时）：
 * ASCII（英文/代码/JSON 结构）约 4 字符 ≈ 1 token，非 ASCII（中文等）约 1 字符 ≈ 1 token。
 * 仅用于「上下文占用构成」展示与压缩阈值的近似，不是精确计费。
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) < 128) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4) + nonAscii;
}

/** 每个内容块的结构开销（JSON framing / 类型标签，借鉴官方 harness token-meter estimate.ts） */
export const BLOCK_OVERHEAD = 4;

/** 每条消息的 role 字段框架开销 */
export const ROLE_OVERHEAD = 4;

/**
 * 估算一条模型可见消息的 token：正文密度 + role 框架 + 思维链 + 工具调用。
 * 相比 `estimateTokens(JSON.stringify(整个数组))`，按消息逐个计价能避免把数组的 JSON 结构重复计入，
 * 并显式加上 role/块结构开销，与供应商真实 token 更接近。
 */
export function estimateMessageTokens(message: unknown): number {
  if (typeof message !== 'object' || message === null) {
    return estimateTokens(String(message)) + ROLE_OVERHEAD;
  }
  const m = message as Record<string, unknown>;
  let tokens = estimateTokens(typeof m['content'] === 'string' ? m['content'] : '') + ROLE_OVERHEAD;
  if (typeof m['reasoning_content'] === 'string') tokens += estimateTokens(m['reasoning_content']);
  if (Array.isArray(m['tool_calls'])) {
    for (const tc of m['tool_calls']) tokens += estimateTokens(JSON.stringify(tc)) + BLOCK_OVERHEAD;
  }
  return tokens;
}

/** 估算系统提示词 token：正文密度 + role 框架 */
export function estimateSystemTokens(systemContent: string): number {
  return estimateTokens(systemContent) + ROLE_OVERHEAD;
}

/** 估算工具 schema token：JSON 密度 + 块结构开销 */
export function estimateToolsTokens(tools: unknown): number {
  return estimateTokens(JSON.stringify(tools)) + BLOCK_OVERHEAD;
}
