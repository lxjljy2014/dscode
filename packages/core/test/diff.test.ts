import { describe, expect, it } from 'vitest';
import { buildDiffFile, diffLines } from '../src/workspace/diff';

describe('diffLines', () => {
  it('相同内容无 diff', () => {
    expect(diffLines('a\nb\nc', 'a\nb\nc')).toEqual([]);
  });

  it('单行替换产生 del + add', () => {
    const lines = diffLines('a\nb\nc', 'a\nx\nc');
    expect(lines.some(l => l.type === 'del' && l.content === 'b')).toBe(true);
    expect(lines.some(l => l.type === 'add' && l.content === 'x')).toBe(true);
  });

  it('删除行', () => {
    const lines = diffLines('a\nb', 'a');
    expect(lines.some(l => l.type === 'del' && l.content === 'b')).toBe(true);
  });

  it('新增行', () => {
    const lines = diffLines('a', 'a\nb');
    expect(lines.some(l => l.type === 'add' && l.content === 'b')).toBe(true);
  });
});

describe('buildDiffFile', () => {
  it('新文件标记 new', () => {
    const f = buildDiffFile('x.txt', null, 'hello\nworld');
    expect(f.status).toBe('new');
    expect(f.additions).toBe(2);
    expect(f.deletions).toBe(0);
  });

  it('删除文件标记 deleted', () => {
    const f = buildDiffFile('x.txt', 'hello\nworld', null);
    expect(f.status).toBe('deleted');
    expect(f.additions).toBe(0);
    expect(f.deletions).toBe(2);
  });

  it('修改文件不标记 status', () => {
    const f = buildDiffFile('x.txt', 'a\nb', 'a\nc');
    expect(f.status).toBeUndefined();
    expect(f.additions).toBe(1);
    expect(f.deletions).toBe(1);
  });
});
