import { MAX_OUTPUT_CHARS } from '../constants';

/** 截断超长输出并注明 */
export function truncate(content: string, max = MAX_OUTPUT_CHARS): string {
  if (content.length <= max) return content;
  return `${content.slice(0, max)}
……（输出过长，已截断）`;
}
