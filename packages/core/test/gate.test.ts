import { describe, expect, it } from 'vitest';
import type { AgentToolName, PermissionMode } from '@dscode/shared';
import { gateTool, isConfirmDecision, needsConfirm } from '../src/gate/gate';

const READ_TOOLS: AgentToolName[] = ['read_file', 'list_dir', 'search'];
const ALL_MODES: PermissionMode[] = ['confirm', 'auto-edit', 'plan', 'full-access'];

describe('needsConfirm', () => {
  it('只读工具在任何模式下都无需确认', () => {
    for (const name of READ_TOOLS) {
      for (const mode of ALL_MODES) {
        expect(needsConfirm(name, mode)).toBe(false);
      }
    }
  });

  it('full-access 下写/执行都无需确认', () => {
    expect(needsConfirm('write_file', 'full-access')).toBe(false);
    expect(needsConfirm('run_command', 'full-access')).toBe(false);
  });

  it('plan 模式：写/执行无需确认（由 gateTool 直接拒绝）', () => {
    expect(needsConfirm('write_file', 'plan')).toBe(false);
    expect(needsConfirm('run_command', 'plan')).toBe(false);
  });

  it('auto-edit：写放行、执行仍需确认', () => {
    expect(needsConfirm('write_file', 'auto-edit')).toBe(false);
    expect(needsConfirm('edit_file', 'auto-edit')).toBe(false);
    expect(needsConfirm('run_command', 'auto-edit')).toBe(true);
  });

  it('confirm：写/执行都需确认', () => {
    expect(needsConfirm('write_file', 'confirm')).toBe(true);
    expect(needsConfirm('run_command', 'confirm')).toBe(true);
  });
});

describe('isConfirmDecision', () => {
  it('合法 kind 通过', () => {
    for (const kind of ['allow-once', 'allow-session', 'deny']) {
      expect(isConfirmDecision({ kind })).toBe(true);
    }
  });

  it('拒绝非法结构', () => {
    expect(isConfirmDecision({ kind: 'maybe' })).toBe(false);
    expect(isConfirmDecision({})).toBe(false);
    expect(isConfirmDecision('allow-once')).toBe(false);
    expect(isConfirmDecision(null)).toBe(false);
    expect(isConfirmDecision(undefined)).toBe(false);
    expect(isConfirmDecision(true)).toBe(false);
  });
});

describe('gateTool', () => {
  it('只读工具直接放行，不触发确认回调', async () => {
    const d = await gateTool('read_file', 'confirm', 't1', '{}', async () => {
      throw new Error('不应触发确认');
    });
    expect(d.allow).toBe(true);
  });

  it('允许一次（allow-once）', async () => {
    const d = await gateTool('write_file', 'confirm', 't2', '{}', async () => ({ kind: 'allow-once' }));
    expect(d.allow).toBe(true);
    expect(d.decision).toEqual({ kind: 'allow-once' });
  });

  it('允许本次会话（allow-session）同样放行并携带决策', async () => {
    const ds = await gateTool('write_file', 'confirm', 't3', '{}', async () => ({ kind: 'allow-session' }));
    expect(ds.allow).toBe(true);
    expect(ds.decision).toEqual({ kind: 'allow-session' });
  });

  it('用户拒绝（deny）', async () => {
    const d = await gateTool('write_file', 'confirm', 't5', '{}', async () => ({ kind: 'deny' }));
    expect(d.allow).toBe(false);
    expect(d.reason).toBe('denied');
    expect(d.decision).toEqual({ kind: 'deny' });
  });

  it('plan 模式写工具直接拒绝', async () => {
    const d = await gateTool('write_file', 'plan', 't7', '{}', async () => ({ kind: 'allow-once' }));
    expect(d.allow).toBe(false);
    expect(d.reason).toBe('plan-mode');
  });

  it('auto-edit 写工具直接放行', async () => {
    const d = await gateTool('write_file', 'auto-edit', 't8', '{}', async () => {
      throw new Error('不应触发确认');
    });
    expect(d.allow).toBe(true);
  });
});
