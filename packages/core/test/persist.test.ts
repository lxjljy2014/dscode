import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AssistantStep, Message, Session } from '@dscode/shared';
import { defaultSettings, loadSettings, saveSettings } from '../src/persist/config';
import type { SettingsCrypto } from '../src/persist/config';
import { backfillSessions, initSessions, listSessions, upsertMessage, upsertSession } from '../src/persist/sessions';
import { initProjects, listProjects, listProjectsWithHome, touchProject } from '../src/persist/projects';

/**
 * persist 层单测：config（JSON 归一化 + 静态加密钩子）与 node:sqlite 的 sessions/projects 落库往返。
 * 覆盖重构中修复的多库隔离（dbs map 按 file 区分）与 apiKey 加密/解密回退。
 */

const home = '/home/user';

function makeSession(id: string, title: string): Session {
  return { id, title, workingDirectory: '/ws', createdAt: 100, updatedAt: 200, messages: [], toolEvents: [] };
}

describe('config 持久化', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dscode-config-'));
    file = join(dir, 'settings.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('文件不存在时返回默认设置', () => {
    expect(loadSettings(file, home)).toEqual(defaultSettings(home));
  });

  it('非法 permissionMode 回退默认、其余字段保留', async () => {
    await writeFile(file, JSON.stringify({ workingDirectory: '/x', permissionMode: 'evil', onboardingDone: true }));
    const s = loadSettings(file, home);
    expect(s.permissionMode).toBe('confirm');
    expect(s.workingDirectory).toBe('/x');
    expect(s.onboardingDone).toBe(true);
  });

  it('无 crypto 时明文落盘', async () => {
    const s = saveSettings(file, home, {
      providers: [{ id: 'p', name: 'P', baseUrl: 'https://x', apiKey: 'sk-secret', models: ['m1'] }]
    });
    expect(s.providers[0]?.apiKey).toBe('sk-secret');
    expect(await readFile(file, 'utf8')).toContain('sk-secret');
  });

  it('crypto 钩子：落盘加密、读回解密', async () => {
    const crypto: SettingsCrypto = {
      encrypt: p => 'ENC:' + p,
      decrypt: c => (c.startsWith('ENC:') ? c.slice(4) : c)
    };
    saveSettings(
      file,
      home,
      { providers: [{ id: 'p', name: 'P', baseUrl: 'https://x', apiKey: 'sk-secret', models: ['m1'] }] },
      crypto
    );
    const raw = await readFile(file, 'utf8');
    expect(raw).toContain('ENC:sk-secret');
    expect(raw).not.toContain('"sk-secret"');
    expect(loadSettings(file, home, crypto).providers[0]?.apiKey).toBe('sk-secret');
  });

  it('patch 合并：只更新传入字段', () => {
    saveSettings(file, home, { workingDirectory: '/a', permissionMode: 'plan' });
    const s = saveSettings(file, home, { workingDirectory: '/b' });
    expect(s.workingDirectory).toBe('/b');
    expect(s.permissionMode).toBe('plan');
  });

  it('deepseek 供应商 adapter 兜底、模型列表保留用户配置（空列表回退预置）', () => {
    const empty = saveSettings(file, home, {
      providers: [
        { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: '', models: [] }
      ]
    });
    expect(empty.providers[0]?.models).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash']);
    expect(empty.providers[0]?.adapter).toBe('deepseek');

    const custom = saveSettings(file, home, {
      providers: [
        { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: '', models: ['deepseek-reasoner'] }
      ]
    });
    expect(custom.providers[0]?.models).toEqual(['deepseek-reasoner']);
  });

  it('commands 落库读回并过滤非法项', () => {
    const saved = saveSettings(file, home, {
      commands: [
        { id: 'c1', name: 'explain', description: '解释代码', prompt: '请解释以下代码：' },
        { id: 'bad', name: 1, description: 'x', prompt: 'y' }
      ]
    });
    expect(saved.commands).toHaveLength(1);
    expect(saved.commands[0]?.name).toBe('explain');
    expect(loadSettings(file, home).commands).toEqual([
      { id: 'c1', name: 'explain', description: '解释代码', prompt: '请解释以下代码：' }
    ]);
  });

  it('memory 落库读回并过滤非法项', () => {
    const saved = saveSettings(file, home, {
      memory: [
        { id: 'm1', content: '本项目使用 pnpm' },
        { id: 'bad', content: 1 }
      ]
    });
    expect(saved.memory).toHaveLength(1);
    expect(saved.memory[0]?.content).toBe('本项目使用 pnpm');
    expect(loadSettings(file, home).memory).toEqual([{ id: 'm1', content: '本项目使用 pnpm' }]);
  });

  it('skills 落库读回并过滤非法项', () => {
    const saved = saveSettings(file, home, {
      skills: [
        { id: 's1', name: 'code-review', description: '代码审查', instructions: '审查代码并给出建议' },
        { id: 'bad', name: 1, description: 'x', instructions: 'y' }
      ]
    });
    expect(saved.skills).toHaveLength(1);
    expect(saved.skills[0]?.name).toBe('code-review');
  });

  it('hooks 落库读回并过滤非法 trigger', () => {
    const saved = saveSettings(file, home, {
      hooks: [
        { id: 'h1', name: 'format', trigger: 'tool_done', command: 'npm run format' },
        { id: 'bad', name: 'x', trigger: 'invalid', command: 'echo' }
      ]
    });
    expect(saved.hooks).toHaveLength(1);
    expect(saved.hooks[0]?.trigger).toBe('tool_done');
  });

  it('subagents 落库读回并过滤非法项', () => {
    const saved = saveSettings(file, home, {
      subagents: [
        { id: 'a1', name: 'reviewer', description: '代码审查', systemPrompt: '你是代码审查专家' },
        { id: 'bad', name: 1, description: 'x', systemPrompt: 'y' }
      ]
    });
    expect(saved.subagents).toHaveLength(1);
    expect(saved.subagents[0]?.name).toBe('reviewer');
  });

  it('无自定义 subagents 时预置默认子智能体', () => {
    const s = loadSettings(file, home);
    expect(s.subagents.length).toBeGreaterThan(0);
    expect(s.subagents.some(x => x.id === 'code-review')).toBe(true);
  });

  it('mcpServers 落库读回并过滤非法项', () => {
    const saved = saveSettings(file, home, {
      mcpServers: [
        { id: 'm1', name: 'filesystem', command: 'npx', args: ['-y', 'server'] },
        { id: 'bad', name: 'x', command: 1, args: [] }
      ]
    });
    expect(saved.mcpServers).toHaveLength(1);
    expect(saved.mcpServers[0]?.name).toBe('filesystem');
  });

  it('browsingEnabled 默认开启、可关闭并读回', () => {
    expect(loadSettings(file, home).browsingEnabled).toBe(true);
    expect(saveSettings(file, home, { browsingEnabled: false }).browsingEnabled).toBe(false);
    expect(loadSettings(file, home).browsingEnabled).toBe(false);
  });
});

describe('sessions 持久化', () => {
  let dir: string;
  let file: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dscode-sessions-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('空库列表为空', () => {
    file = join(dir, 'empty.db');
    initSessions(file);
    expect(listSessions(file)).toEqual([]);
  });

  it('会话与消息落库读回', () => {
    file = join(dir, 'roundtrip.db');
    initSessions(file);
    upsertSession(file, makeSession('s1', '第一'));
    upsertMessage(file, 's1', { id: 'm1', role: 'user', content: 'hi', createdAt: 300 });
    upsertMessage(file, 's1', { id: 'm2', role: 'assistant', content: 'hello', createdAt: 400 });
    const list = listSessions(file);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('s1');
    expect(list[0]?.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(list[0]?.toolEvents).toEqual([]);
  });

  it('upsert 幂等：同 id 覆盖而非重复', () => {
    file = join(dir, 'idempotent.db');
    initSessions(file);
    upsertSession(file, makeSession('s1', 'a'));
    upsertSession(file, makeSession('s1', 'b'));
    expect(listSessions(file)).toHaveLength(1);
    expect(listSessions(file)[0]?.title).toBe('b');
  });

  it('消息 errorCode 可空且可选', () => {
    file = join(dir, 'errorcode.db');
    initSessions(file);
    upsertSession(file, makeSession('s1', 'a'));
    const withErr: Message = { id: 'm1', role: 'assistant', content: 'x', errorCode: 'api', createdAt: 1 };
    upsertMessage(file, 's1', withErr);
    upsertMessage(file, 's1', { id: 'm2', role: 'user', content: 'y', createdAt: 2 });
    const msgs = listSessions(file)[0]?.messages;
    expect(msgs?.[0]?.errorCode).toBe('api');
    expect(msgs?.[1]?.errorCode).toBeUndefined();
  });

  it('steps（思维链/工具/正文交错）落库读回且顺序保持', () => {
    file = join(dir, 'steps.db');
    initSessions(file);
    upsertSession(file, makeSession('s1', 'a'));
    const steps: AssistantStep[] = [
      { kind: 'reasoning', content: '先看看文件结构' },
      { kind: 'tool', event: { id: 'e1', name: 'read_file', args: '{"path":"a.ts"}', status: 'done', createdAt: 1 } },
      { kind: 'tool', event: { id: 'e2', name: 'write_file', args: '{"path":"b.ts"}', status: 'done', summary: '已写入', createdAt: 2 } },
      { kind: 'text', content: '已完成' }
    ];
    upsertMessage(file, 's1', { id: 'm1', role: 'assistant', content: '已完成', steps, createdAt: 3 });
    const msg = listSessions(file)[0]?.messages[0];
    expect(msg?.steps).toEqual(steps);
    expect(msg?.content).toBe('已完成');
  });

  it('无 steps 的老消息读回不带 steps（渲染端走正文兜底）', () => {
    file = join(dir, 'nosteps.db');
    initSessions(file);
    upsertSession(file, makeSession('s1', 'a'));
    upsertMessage(file, 's1', { id: 'm1', role: 'assistant', content: '正文', createdAt: 1 });
    expect(listSessions(file)[0]?.messages[0]?.steps).toBeUndefined();
  });

  it('崩溃残留的非终态工具事件读回归一化为 error 并补说明', () => {
    file = join(dir, 'interrupted.db');
    initSessions(file);
    upsertSession(file, makeSession('s1', 'a'));
    const steps: AssistantStep[] = [
      { kind: 'tool', event: { id: 'e1', name: 'run_command', args: '{"command":"x"}', status: 'running', createdAt: 1 } },
      { kind: 'tool', event: { id: 'e2', name: 'edit_file', args: '{"path":"y"}', status: 'confirming', error: '用户未响应', createdAt: 2 } }
    ];
    upsertMessage(file, 's1', { id: 'm1', role: 'assistant', content: '', steps, createdAt: 3 });
    const msg = listSessions(file)[0]?.messages[0];
    const events = msg?.steps?.map(s => (s.kind === 'tool' ? s.event : null));
    expect(events?.[0]?.status).toBe('error');
    expect(events?.[0]?.error).toBe('会话中断，工具未完成');
    expect(events?.[1]?.status).toBe('error');
    expect(events?.[1]?.error).toBe('用户未响应');
  });

  it('steps JSON 损坏时读回无 steps（不抛异常）', () => {
    file = join(dir, 'corrupt.db');
    initSessions(file);
    upsertSession(file, makeSession('s1', 'a'));
    upsertMessage(file, 's1', { id: 'm1', role: 'assistant', content: '正文', createdAt: 1 });
    const db = new DatabaseSync(file);
    db.prepare('UPDATE messages SET steps = ? WHERE id = ?').run('not-json', 'm1');
    db.close();
    const msg = listSessions(file)[0]?.messages[0];
    expect(msg?.steps).toBeUndefined();
    expect(msg?.content).toBe('正文');
  });

  it('旧库无 steps 列时自动迁移并可正常读写', () => {
    file = join(dir, 'migrate.db');
    // 按早期 schema 手工建库（messages 无 steps 列）
    const db = new DatabaseSync(file);
    db.exec(
      'CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, ' +
        "working_directory TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
    );
    db.exec(
      'CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, ' +
        'content TEXT NOT NULL, error_code TEXT, created_at INTEGER NOT NULL)'
    );
    db.close();
    initSessions(file);
    upsertSession(file, makeSession('s1', '旧会话'));
    upsertMessage(file, 's1', {
      id: 'm1',
      role: 'assistant',
      content: 'x',
      steps: [{ kind: 'text', content: 'x' }],
      createdAt: 1
    });
    const msg = listSessions(file)[0]?.messages[0];
    expect(msg?.content).toBe('x');
    expect(msg?.steps).toEqual([{ kind: 'text', content: 'x' }]);
  });

  it('backfill 回填空工作目录', () => {
    file = join(dir, 'backfill.db');
    initSessions(file);
    const s = makeSession('s1', 'a');
    s.workingDirectory = '';
    upsertSession(file, s);
    backfillSessions(file, '/new-ws');
    expect(listSessions(file)[0]?.workingDirectory).toBe('/new-ws');
  });

  it('多库文件隔离（dbs map 按 file 区分）', () => {
    const file1 = join(dir, 'iso1.db');
    const file2 = join(dir, 'iso2.db');
    initSessions(file1);
    initSessions(file2);
    upsertSession(file1, makeSession('s1', '库1'));
    upsertSession(file2, makeSession('s2', '库2'));
    expect(listSessions(file1).map(s => s.id)).toEqual(['s1']);
    expect(listSessions(file2).map(s => s.id)).toEqual(['s2']);
  });
});

describe('projects 持久化', () => {
  let dir: string;
  let file: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dscode-projects-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('空库列表为空', () => {
    file = join(dir, 'empty.db');
    initProjects(file);
    expect(listProjects(file)).toEqual([]);
  });

  it('touch 记录并按打开时间倒序', async () => {
    file = join(dir, 'order.db');
    initProjects(file);
    touchProject(file, '/a/foo');
    await new Promise(r => setTimeout(r, 20));
    touchProject(file, '/b/bar');
    expect(listProjects(file).map(p => p.name)).toEqual(['bar', 'foo']);
  });

  it('同名 path 去重', () => {
    file = join(dir, 'dedupe.db');
    initProjects(file);
    touchProject(file, '/a/foo');
    touchProject(file, '/a/foo');
    expect(listProjects(file)).toHaveLength(1);
  });

  it('名字取路径末段', () => {
    file = join(dir, 'name.db');
    initProjects(file);
    touchProject(file, '/some/dir/project-name');
    expect(listProjects(file)[0]?.name).toBe('project-name');
  });

  it('listProjectsWithHome 附带 homeDir', () => {
    file = join(dir, 'home.db');
    const r = listProjectsWithHome(file, '/home/x');
    expect(r.homeDir).toBe('/home/x');
    expect(r.projects).toEqual([]);
  });
});
