import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveSafePath } from '../src/workspace/paths';

let base: string;
let cwd: string;
let outside: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'dscode-paths-'));
  cwd = join(base, 'ws');
  outside = join(base, 'outside');
  await mkdir(cwd);
  await mkdir(outside);
  await writeFile(join(cwd, 'a.txt'), 'a');
  await writeFile(join(outside, 'secret.txt'), 'secret');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('resolveSafePath', () => {
  it('允许工作目录内路径', async () => {
    expect(await resolveSafePath(cwd, 'a.txt')).toBe(join(cwd, 'a.txt'));
  });

  it('拒绝 ../ 直接越界', async () => {
    expect(await resolveSafePath(cwd, '../outside/secret.txt')).toBeNull();
  });

  it('拒绝软链接指向目录外', async () => {
    try {
      await symlink(outside, join(cwd, 'link-out'), 'dir');
    } catch {
      return; // 平台不支持软链接则跳过
    }
    expect(await resolveSafePath(cwd, 'link-out/secret.txt')).toBeNull();
  });

  it('允许不存在的目标（其最近存在的祖先在 cwd 内；父目录存在性由 write_file 把关）', async () => {
    expect(await resolveSafePath(cwd, 'nested.txt')).toBe(join(cwd, 'nested.txt'));
  });

  it('拒绝经软链接指向目录外的更深层不存在路径', async () => {
    try {
      await symlink(outside, join(cwd, 'link-deep'), 'dir');
    } catch {
      return; // 平台不支持软链接则跳过
    }
    expect(await resolveSafePath(cwd, 'link-deep/sub/secret.txt')).toBeNull();
  });
});
