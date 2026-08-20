import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { DiffFile, DiffLine } from '@dscode/shared';
import { MAX_FILE_BYTES } from '../constants';
import { SKIP_DIRS } from './paths';

/**
 * 真实 diff：每次 agent 运行在启动时快照工作目录全部文本文件，
 * 写/执行工具执行成功后对比快照与当前内容，LCS 行级 diff 结果由调用方推送。
 * 写/编辑工具回报 changedPaths 时只对增量路径重算；run_command 无法追踪则退化为全量扫描。
 */

/** LCS 动态规划规模上限（old行数 × new行数），超出退化为整文件替换 */
const MAX_LCS_CELLS = 4_000_000;
/** hunk 两侧保留的上下文行数 */
const CONTEXT_LINES = 3;

/** 快照/全量 diff 最多收集的文件数：超大仓库 OOM 安全阀，超出告警并截断（超出部分不参与 diff） */
export const MAX_SNAPSHOT_FILES = 20_000;

/** 收集工作目录内全部文本文件（≤512KB，跳过 node_modules/.git/out/dist）；maxFiles 上限超出截断 */
export async function collectTextFiles(cwd: string, maxFiles = Number.POSITIVE_INFINITY): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let truncated = false;
  const walk = async (dir: string): Promise<void> => {
    if (files.size >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files.size >= maxFiles) {
        truncated = true;
        return;
      }
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name));
        continue;
      }
      if (!e.isFile()) continue;
      const full = join(dir, e.name);
      try {
        const st = await stat(full);
        if (st.size > MAX_FILE_BYTES) continue;
        // 快照键统一 posix 分隔符（Windows 下 relative() 产出反斜杠，会导致跨平台路径键不一致）
        files.set(relative(cwd, full).split(sep).join('/'), await readFile(full, 'utf8'));
      } catch {
        // 二进制/不可读文件跳过
      }
    }
  };
  await walk(cwd);
  if (truncated) console.warn(`[diff] 工作区文件数超过 ${maxFiles}，快照已截断（超出部分不参与 diff）`);
  return files;
}

/** 读取单个文件当前文本（缺失/过大/不可读返回 null） */
async function readCurrentText(cwd: string, relPath: string): Promise<string | null> {
  try {
    const full = join(cwd, relPath);
    const st = await stat(full);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return await readFile(full, 'utf8');
  } catch {
    return null;
  }
}

/** 单文件 LCS 行级 diff（DP + 回溯；规模超限退化为整文件替换） */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;

  // 规模超限：整文件替换（先全删后全加）
  if (n * m > MAX_LCS_CELLS) {
    const lines: DiffLine[] = [
      { type: 'hunk', content: `@@ -1,${n} +1,${m} @@` },
      ...a.map((content, i) => ({ type: 'del', content, oldLineNo: i + 1 }) as DiffLine),
      ...b.map((content, i) => ({ type: 'add', content, newLineNo: i + 1 }) as DiffLine)
    ];
    return lines;
  }

  // DP：dp[(i)*(m+1)+j] 表示 a[0..i) 与 b[0..j) 的 LCS 长度
  const dp = new Int32Array((n + 1) * (m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i * (m + 1) + j] =
        a[i - 1] === b[j - 1]
          ? dp[(i - 1) * (m + 1) + j - 1] + 1
          : Math.max(dp[(i - 1) * (m + 1) + j], dp[i * (m + 1) + j - 1]);
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
    const inHunk =
      changedIdx.has(idx) ||
      Array.from({ length: CONTEXT_LINES * 2 + 1 }, (_, k) => idx - CONTEXT_LINES + k).some(k => changedIdx.has(k));
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
      if (op.kind === 'eq')
        lines.push({ type: 'context', content: op.content, oldLineNo: op.oldLine, newLineNo: op.newLine });
      else if (op.kind === 'del') lines.push({ type: 'del', content: op.content, oldLineNo: op.oldLine });
      else lines.push({ type: 'add', content: op.content, newLineNo: op.newLine });
    }
  }
  return lines;
}

/** 构建单个文件的 DiffFile（新增/删除文件整文件标记） */
export function buildDiffFile(relPath: string, oldText: string | null, newText: string | null): DiffFile {
  if (oldText === null) {
    const b = newText!.split('\n');
    return {
      path: relPath,
      status: 'new',
      additions: b.length,
      deletions: 0,
      lines: [
        { type: 'hunk', content: `@@ -0,0 +1,${b.length} @@` },
        ...b.map((content, i) => ({ type: 'add', content, newLineNo: i + 1 }) as DiffLine)
      ]
    };
  }
  if (newText === null) {
    const a = oldText.split('\n');
    return {
      path: relPath,
      status: 'deleted',
      additions: 0,
      deletions: a.length,
      lines: [
        { type: 'hunk', content: `@@ -1,${a.length} +0,0 @@` },
        ...a.map((content, i) => ({ type: 'del', content, oldLineNo: i + 1 }) as DiffLine)
      ]
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

/** 内存中最多保留多少个会话的快照（运行结束后保留供回滚；超限淘汰最旧，约束内存占用） */
export const MAX_SESSION_SNAPSHOTS = 8;

/**
 * 每会话一份快照存储（实例化，避免模块级全局单例的串扰）。
 * 由 AgentRuntime 各持有一份，便于多实例与单测隔离。
 * 运行结束后快照保留（下一次运行启动时覆盖），供「恢复到运行前」回滚使用。
 */
export class DiffSnapshotStore {
  private snapshots = new Map<string, Map<string, string>>();
  private cwds = new Map<string, string>();

  /** agent 启动时建立快照 */
  async initSnapshot(sessionId: string, cwd: string): Promise<void> {
    // 先删再 set 刷新 Map 插入顺序（LRU 淘汰按插入序）
    this.snapshots.delete(sessionId);
    this.cwds.delete(sessionId);
    this.snapshots.set(sessionId, await collectTextFiles(cwd, MAX_SNAPSHOT_FILES));
    this.cwds.set(sessionId, cwd);
    while (this.snapshots.size > MAX_SESSION_SNAPSHOTS) {
      const oldest = this.snapshots.keys().next().value;
      if (oldest === undefined) break;
      this.clearSnapshot(oldest);
    }
  }

  /** 是否存在会话快照 */
  hasSnapshot(sessionId: string): boolean {
    return this.snapshots.has(sessionId);
  }

  /** 清理会话快照（显式放弃回滚能力：提交改动后调用；全量 dispose 由运行时负责） */
  clearSnapshot(sessionId: string): void {
    this.snapshots.delete(sessionId);
    this.cwds.delete(sessionId);
  }

  /**
   * 恢复会话工作区到快照状态（撤销 agent 运行的文件改动）：
   * 修改/删除的文件写回原文，运行期间新增的文件删除。
   * 只恢复「快照 vs 当前」有差异的文件，未涉及文件一律不动。
   * 返回恢复的文件数与恢复后的剩余 diff（正常应为空，非空说明个别文件恢复失败）。
   */
  async restoreSnapshot(sessionId: string): Promise<{ restored: number; files: DiffFile[] }> {
    const snap = this.snapshots.get(sessionId);
    const cwd = this.cwds.get(sessionId);
    if (!snap || !cwd) return { restored: 0, files: [] };
    const diffs = await this.recomputeDiff(sessionId, cwd);
    for (const f of diffs) {
      // 防御：快照键由 relative() 生成、必然是 cwd 内相对路径，异常路径直接跳过
      if (f.path.startsWith('..') || isAbsolute(f.path)) continue;
      const full = join(cwd, f.path);
      try {
        if (snap.has(f.path)) {
          await mkdir(dirname(full), { recursive: true });
          await writeFile(full, snap.get(f.path)!, 'utf8');
        } else {
          // 快照中不存在 = 运行期间新增的文件：回滚即删除
          await rm(full, { force: true });
        }
      } catch {
        // 单文件恢复失败（权限/占用）：继续其余文件，最终 diff 会暴露未恢复项
      }
    }
    return { restored: diffs.length, files: await this.recomputeDiff(sessionId, cwd) };
  }

  /** 对比快照与当前内容，返回 diff 文件列表（推送由调用方负责） */
  async recomputeDiff(sessionId: string, cwd: string, changedPaths?: string[]): Promise<DiffFile[]> {
    const snap = this.snapshots.get(sessionId);
    if (!snap) return [];
    const files: DiffFile[] = [];

    if (changedPaths) {
      // 增量：只重算回报的变更路径
      for (const p of changedPaths) {
        const oldText = snap.has(p) ? snap.get(p)! : null;
        const newText = await readCurrentText(cwd, p);
        if (oldText !== null && newText !== null && oldText === newText) continue;
        files.push(buildDiffFile(p, oldText, newText));
      }
    } else {
      // 全量：对比快照键与当前全部文件（run_command 等无法追踪路径时）
      const current = await collectTextFiles(cwd, MAX_SNAPSHOT_FILES);
      const allPaths = new Set([...snap.keys(), ...current.keys()]);
      for (const p of allPaths) {
        const oldText = snap.has(p) ? snap.get(p)! : null;
        const newText = current.has(p) ? current.get(p)! : null;
        if (oldText !== null && newText !== null && oldText === newText) continue;
        files.push(buildDiffFile(p, oldText, newText));
      }
    }
    files.sort((x, y) => x.path.localeCompare(y.path));
    return files;
  }
}
