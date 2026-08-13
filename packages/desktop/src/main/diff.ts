import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { DiffFile, DiffLine } from '@dscode/shared';
import { SKIP_DIRS } from './agent-tools';

/**
 * 真实 diff：每会话在 agent 启动时快照工作目录全部文本文件，
 * 写/执行工具执行成功后对比快照与当前内容，LCS 行级 diff 经 workspace:diff 推给渲染端。
 */

const MAX_FILE_BYTES = 512 * 1024;
/** LCS 动态规划规模上限（old行数 × new行数），超出退化为整文件替换 */
const MAX_LCS_CELLS = 4_000_000;
/** hunk 两侧保留的上下文行数 */
const CONTEXT_LINES = 3;

const snapshots = new Map<string, Map<string, string>>();

/** 收集工作目录内全部文本文件（≤512KB，跳过 node_modules/.git/out/dist） */
function collectTextFiles(cwd: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
        continue;
      }
      if (!e.isFile()) continue;
      const full = join(dir, e.name);
      try {
        const stat = statSync(full);
        if (stat.size > MAX_FILE_BYTES) return;
        files.set(relative(cwd, full), readFileSync(full, 'utf8'));
      } catch {
        // 二进制/不可读文件跳过
      }
    }
  };
  walk(cwd);
  return files;
}

/** agent 启动时建立快照 */
export function initSnapshot(sessionId: string, cwd: string): void {
  snapshots.set(sessionId, collectTextFiles(cwd));
}

/** agent 运行结束后清理快照 */
export function clearSnapshot(sessionId: string): void {
  snapshots.delete(sessionId);
}

/** 单文件 LCS 行级 diff（DP + 回溯；规模超限退化为整文件替换） */
function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;

  // 规模超限：整文件替换（先全删后全加）
  if (n * m > MAX_LCS_CELLS) {
    const lines: DiffLine[] = [
      { type: 'hunk', content: `@@ -1,${n} +1,${m} @@` },
      ...a.map((content, i) => ({ type: 'del', content, oldLineNo: i + 1 } as DiffLine)),
      ...b.map((content, i) => ({ type: 'add', content, newLineNo: i + 1 } as DiffLine))
    ];
    return lines;
  }

  // DP：dp[(i)*(m+1)+j] 表示 a[0..i) 与 b[0..j) 的 LCS 长度
  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i * (m + 1) + j] =
        a[i - 1] === b[j - 1] ? dp[(i - 1) * (m + 1) + j - 1] + 1 : Math.max(dp[(i - 1) * (m + 1) + j], dp[i * (m + 1) + j - 1]);
    }
  }

  // 回溯生成操作序列
  type Op = { kind: 'eq' | 'del' | 'add'; oldLine?: number; newLine?: number; content: string };
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ kind: 'eq', oldLine: i, newLine: j, content: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i * (m + 1) + j - 1] >= dp[(i - 1) * (m + 1) + j])) {
      ops.push({ kind: 'add', newLine: j, content: b[j - 1] });
      j--;
    } else {
      ops.push({ kind: 'del', oldLine: i, content: a[i - 1] });
      i--;
    }
  }
  ops.reverse();

  // 变更区间：连续非 eq 操作 ± 上下文行，重叠区间合并
  const changedIdx = new Set<number>();
  ops.forEach((op, idx) => {
    if (op.kind !== 'eq') changedIdx.add(idx);
  });
  const hunks: Array<[number, number]> = [];
  let start = -1;
  let end = -1;
  for (let idx = 0; idx < ops.length; idx++) {
    const inHunk = changedIdx.has(idx) || Array.from({ length: CONTEXT_LINES * 2 + 1 }, (_, k) => idx - CONTEXT_LINES + k).some(k => changedIdx.has(k));
    if (inHunk) {
      if (start === -1) start = idx;
      end = idx;
    } else if (start !== -1) {
      hunks.push([start, end]);
      start = -1;
      end = -1;
    }
  }
  if (start !== -1) hunks.push([start, end]);

  // 生成 DiffLine（hunk 头 + 行内容，行号沿用原始行号语义）
  const lines: DiffLine[] = [];
  for (const [s, e] of hunks) {
    let oldCount = 0;
    let newCount = 0;
    for (let idx = s; idx <= e; idx++) {
      if (ops[idx].kind !== 'add') oldCount++;
      if (ops[idx].kind !== 'del') newCount++;
    }
    const oldStart = ops[s].oldLine ?? ops[s + 1]?.oldLine ?? 0;
    const newStart = ops[s].newLine ?? ops[s + 1]?.newLine ?? 0;
    lines.push({ type: 'hunk', content: `@@ -${oldStart || 0},${oldCount} +${newStart || 0},${newCount} @@` });
    for (let idx = s; idx <= e; idx++) {
      const op = ops[idx];
      if (op.kind === 'eq') lines.push({ type: 'context', content: op.content, oldLineNo: op.oldLine, newLineNo: op.newLine });
      else if (op.kind === 'del') lines.push({ type: 'del', content: op.content, oldLineNo: op.oldLine });
      else lines.push({ type: 'add', content: op.content, newLineNo: op.newLine });
    }
  }
  return lines;
}

/** 构建单个文件的 DiffFile（新增/删除文件整文件标记） */
function buildDiffFile(relPath: string, oldText: string | null, newText: string | null): DiffFile {
  if (oldText === null) {
    const b = newText!.split('\n');
    return {
      path: relPath,
      status: 'new',
      additions: b.length,
      deletions: 0,
      lines: [{ type: 'hunk', content: `@@ -0,0 +1,${b.length} @@` }, ...b.map((content, i) => ({ type: 'add', content, newLineNo: i + 1 }) as DiffLine)]
    };
  }
  if (newText === null) {
    const a = oldText.split('\n');
    return {
      path: relPath,
      status: 'deleted',
      additions: 0,
      deletions: a.length,
      lines: [{ type: 'hunk', content: `@@ -1,${a.length} +0,0 @@` }, ...a.map((content, i) => ({ type: 'del', content, oldLineNo: i + 1 }) as DiffLine)]
    };
  }
  const lines = diffLines(oldText, newText);
  return {
    path: relPath,
    additions: lines.filter(l => l.type === 'add').length,
    deletions: lines.filter(l => l.type === 'del').length,
    lines
  };
}

/** 对比快照与当前内容，推送 workspace:diff 事件，返回 diff 文件列表 */
export function recomputeDiff(win: BrowserWindow, sessionId: string, cwd: string): DiffFile[] {
  const snap = snapshots.get(sessionId);
  if (!snap) return [];
  const current = collectTextFiles(cwd);
  const allPaths = new Set([...snap.keys(), ...current.keys()]);
  const files: DiffFile[] = [];
  for (const p of allPaths) {
    const oldText = snap.has(p) ? snap.get(p)! : null;
    const newText = current.has(p) ? current.get(p)! : null;
    if (oldText !== null && newText !== null && oldText === newText) continue;
    files.push(buildDiffFile(p, oldText, newText));
  }
  files.sort((x, y) => x.path.localeCompare(y.path));
  if (!win.isDestroyed()) win.webContents.send('workspace:diff', { sessionId, files });
  return files;
}
