import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authorizeAttachmentPaths, isAuthorizedAttachmentPath, readAttachment } from '../src/main/attachment';

/** attachment:read 的授权路径白名单与读取行为（主进程纯逻辑，无 electron 依赖） */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dscode-attachment-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('authorizeAttachmentPaths / isAuthorizedAttachmentPath', () => {
  it('授权后放行、未授权拒绝、null 安全', () => {
    expect(isAuthorizedAttachmentPath('/tmp/a')).toBe(false);
    authorizeAttachmentPaths(['/tmp/a', '/tmp/b']);
    expect(isAuthorizedAttachmentPath('/tmp/a')).toBe(true);
    expect(isAuthorizedAttachmentPath('/tmp/b')).toBe(true);
    expect(isAuthorizedAttachmentPath('/tmp/c')).toBe(false);
    authorizeAttachmentPaths(null);
    expect(isAuthorizedAttachmentPath('/tmp/c')).toBe(false);
  });
});

describe('readAttachment', () => {
  it('读取文本文件返回 kind:text', async () => {
    const f = join(dir, 'a.txt');
    await writeFile(f, 'hello', 'utf8');
    const r = await readAttachment(f);
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === 'text') expect(r.text).toBe('hello');
  });

  it('含 NUL 字节按二进制拒绝', async () => {
    const f = join(dir, 'b.bin');
    await writeFile(f, Buffer.from([0, 1, 2]));
    const r = await readAttachment(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('二进制');
  });

  it('不存在文件返回错误', async () => {
    const r = await readAttachment(join(dir, 'nope.txt'));
    expect(r.ok).toBe(false);
  });
});
