/**
 * 单文件行级 diff（LCS + 回溯，规模超限退化为整文件替换）。
 * 放在 ui 层自包含：ui 只依赖 @dscode/shared（契约），不能 import @dscode/core 的 LCS，
 * 故此处提供一份轻量实现，供工具卡 diff 块渲染（修复朴素逐行 zip 在插删行时的错位）。
 */

/** LCS 动态规划规模上限（old 行数 × new 行数），超出退化为整文件替换 */
const MAX_LCS_CELLS = 1_000_000;

export interface UiDiffLine {
  type: 'add' | 'del' | 'context';
  content: string;
}

export function diffLinesUi(oldText: string, newText: string): UiDiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;

  if (n * m > MAX_LCS_CELLS) {
    const lines: UiDiffLine[] = [];
    for (const x of a) lines.push({ type: 'del', content: x });
    for (const x of b) lines.push({ type: 'add', content: x });
    return lines;
  }

  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i * (m + 1) + j] =
        a[i - 1] === b[j - 1]
          ? dp[(i - 1) * (m + 1) + j - 1] + 1
          : Math.max(dp[(i - 1) * (m + 1) + j], dp[i * (m + 1) + j - 1]);
    }
  }

  const ops: Array<'eq' | 'del' | 'add'> = [];
  const contents: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push('eq');
      contents.push(a[i - 1]);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i * (m + 1) + j - 1] >= dp[(i - 1) * (m + 1) + j])) {
      ops.push('add');
      contents.push(b[j - 1]);
      j--;
    } else {
      ops.push('del');
      contents.push(a[i - 1]);
      i--;
    }
  }
  ops.reverse();
  contents.reverse();

  const lines: UiDiffLine[] = [];
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    lines.push({ type: op === 'eq' ? 'context' : op, content: contents[k] });
  }
  return lines;
}
