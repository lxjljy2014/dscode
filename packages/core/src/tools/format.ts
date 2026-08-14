/** 单次输出上限（字符数） */
export const MAX_OUTPUT_CHARS = 24 * 1024;

/** 截断超长输出并注明 */
export function truncate(content: string, max = MAX_OUTPUT_CHARS): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}\n……（输出过长，已截断）`;
}
