/**
 * 粗略估算文本 token 数（无本地 tokenizer 时的启发式）：
 * ASCII（英文/代码/JSON 结构）约 4 字符 ≈ 1 token，非 ASCII（中文等）约 1 字符 ≈ 1 token。
 * 仅用于「上下文占用构成」展示的近似拆分，不是精确计费。
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
