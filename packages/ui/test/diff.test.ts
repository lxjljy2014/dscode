import { describe, expect, it } from 'vitest';
import { diffLinesUi } from '../src/utils/diff';

/** ui 层 LCS 行 diff：增删行识别、退化路径 */

describe('diffLinesUi', () => {
  it('纯新增行', () => {
    const lines = diffLinesUi('a\nb', 'a\nx\nb');
    expect(lines).toEqual([
      { type: 'context', content: 'a' },
      { type: 'add', content: 'x' },
      { type: 'context', content: 'b' }
    ]);
  });

  it('纯删除行', () => {
    const lines = diffLinesUi('a\nx\nb', 'a\nb');
    expect(lines).toEqual([
      { type: 'context', content: 'a' },
      { type: 'del', content: 'x' },
      { type: 'context', content: 'b' }
    ]);
  });

  it('修改行 = 删旧 + 加新', () => {
    const lines = diffLinesUi('a\nold\nb', 'a\nnew\nb');
    expect(lines).toContainEqual({ type: 'del', content: 'old' });
    expect(lines).toContainEqual({ type: 'add', content: 'new' });
    expect(lines.filter(l => l.type === 'context').map(l => l.content)).toEqual(['a', 'b']);
  });

  it('完全相同：全部 context', () => {
    const lines = diffLinesUi('a\nb', 'a\nb');
    expect(lines.every(l => l.type === 'context')).toBe(true);
    expect(lines).toHaveLength(2);
  });

  it('一边为空：另一边全量 add/del', () => {
    expect(diffLinesUi('', 'x\ny')).toEqual([
      { type: 'del', content: '' },
      { type: 'add', content: 'x' },
      { type: 'add', content: 'y' }
    ]);
    expect(diffLinesUi('x\ny', '')).toEqual([
      { type: 'del', content: 'x' },
      { type: 'del', content: 'y' },
      { type: 'add', content: '' }
    ]);
  });

  it('规模超限退化为整文件替换（全部 del + 全部 add）', () => {
    // 1200 × 1200 > 1M cells 上限
    const a = Array.from({ length: 1200 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 1200 }, (_, i) => `b${i}`).join('\n');
    const lines = diffLinesUi(a, b);
    const dels = lines.filter(l => l.type === 'del');
    const adds = lines.filter(l => l.type === 'add');
    expect(dels).toHaveLength(1200);
    expect(adds).toHaveLength(1200);
    expect(lines.filter(l => l.type === 'context')).toHaveLength(0);
  });
});
