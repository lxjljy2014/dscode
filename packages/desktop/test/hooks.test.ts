import { beforeEach, describe, expect, it, vi } from 'vitest';

const exec = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ exec }));

import { fireHooks } from '../src/main/hooks';
import type { Hook } from '@dscode/shared';

const hooks: Hook[] = [
  { id: 'h1', name: 'start', trigger: 'session_start', command: 'echo start' },
  { id: 'h2', name: 'done', trigger: 'tool_done', command: 'echo done' }
];

beforeEach(() => {
  exec.mockReset();
  exec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error | null) => void) => {
    cb(null);
  });
});

describe('fireHooks', () => {
  it('只触发匹配 trigger 的钩子', () => {
    fireHooks(hooks, 'session_start', '/ws');
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith('echo start', { cwd: '/ws' }, expect.any(Function));
  });

  it('无匹配钩子时不执行任何命令', () => {
    fireHooks(hooks, 'session_end', '/ws');
    expect(exec).not.toHaveBeenCalled();
  });
});
