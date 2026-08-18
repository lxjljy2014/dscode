import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { editFileTool } from '../src/tools/edit-file';

/** edit_file：替换串中的 $ 序列必须按字面量写入（此前 replace(str,str) 会展开 $ 导致静默损坏） */

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'dscode-edit-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('editFileTool', () => {
  it('替换串含 $$ 时按字面量写入（Makefile 场景）', async () => {
    const p = 'Makefile';
    await writeFile(join(cwd, p), 'TARGET := A\n', 'utf8');
    const r = await editFileTool.execute({ path: p, old_string: 'TARGET := A', new_string: 'TARGET := $$HOME' }, { cwd });
    expect(r.ok).toBe(true);
    expect(await readFile(join(cwd, p), 'utf8')).toBe('TARGET := $$HOME\n');
  });

  it('替换串含 $& 与 $1 时按字面量写入（shell 场景）', async () => {
    const p = 'run.sh';
    await writeFile(join(cwd, p), 'echo X\n', 'utf8');
    const newString = "echo $& $' $1";
    const r = await editFileTool.execute({ path: p, old_string: 'echo X', new_string: newString }, { cwd });
    expect(r.ok).toBe(true);
    expect(await readFile(join(cwd, p), 'utf8')).toBe(newString + '\n');
  });

  it('old_string 匹配多处时报错（要求唯一）', async () => {
    await writeFile(join(cwd, 'a.txt'), 'foo foo', 'utf8');
    const r = await editFileTool.execute({ path: 'a.txt', old_string: 'foo', new_string: 'bar' }, { cwd });
    expect(r.ok).toBe(false);
  });

  it('old_string 未找到报错', async () => {
    await writeFile(join(cwd, 'a.txt'), 'hello', 'utf8');
    const r = await editFileTool.execute({ path: 'a.txt', old_string: 'nope', new_string: 'x' }, { cwd });
    expect(r.ok).toBe(false);
  });
});
