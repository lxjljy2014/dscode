import { appendFileSync, existsSync } from 'node:fs';
import { appendFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AssistantStep, Message, ProviderConfig, Session } from '@dscode/shared';
import { defaultSettings, loadSettings, saveSettings } from '../src/persist/config';
import type { SettingsCrypto } from '../src/persist/config';
import {
  backfillSessions,
  getSessionStats,
  initSessions,
  listSessions,
  setSessionArchived,
  setSessionStats,
  upsertMessage,
  upsertSession
} from '../src/persist/sessions';
import {
  closeProjectsDbs,
  initProjects,
  listProjects,
  listProjectsWithHome,
  listRemovedProjects,
  removeProject,
  touchProject
} from '../src/persist/projects';

/**
 * persist 层单测：config（JSON 归一化 + 静态加密钩子）与 node:sqlite 的 sessions/projects 落库往返。
 * 覆盖重构中修复的多库隔离（dbs map 按 file 区分）与 apiKey 加密/解密回退。
 */

const home = '/home/user';

function makeSession(id: string, title: string): Session {
  return { id, title, workingDirectory: '/ws', createdAt: 100, updatedAt: 200, messages: [], toolEvents: [] };
}

describe('config 持久化（按域拆分配置文件）', () => {
  let dir: string;
  let configDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dscode-config-'));
    configDir = join(dir, 'config');
    await mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('目录不存在时返回默认设置', () => {
    expect(loadSettings(configDir, home)).toEqual(defaultSettings(home));
  });

  it('默认设置预置内置技能；显式空数组尊重用户删除', async () => {
    const defaults = defaultSettings(home);
    expect(defaults.skills.length).toBeGreaterThan(0);
    expect(defaults.skills.map(s => s.name)).toContain('code-review');
    // skills.json 缺失（未配置）回退内置技能
    await writeFile(join(configDir, 'general.json'), JSON.stringify({ workingDirectory: '/x' }));
    expect(loadSettings(configDir, home).skills.length).toBe(defaults.skills.length);
    // 显式保存空列表：用户删除全部技能后保持为空，不再回退
    saveSettings(configDir, home, { skills: [] });
    expect(loadSettings(configDir, home).skills).toEqual([]);
  });

  it('按域拆分：save 只写变更域文件，其他域文件不被触碰', async () => {
    saveSettings(configDir, home, { workingDirectory: '/a', permissionMode: 'plan' });
    const generalBefore = await readFile(join(configDir, 'general.json'), 'utf8');
    const parsedBefore = JSON.parse(generalBefore);
    expect(parsedBefore.workingDirectory).toBe('/a');
    expect(parsedBefore.permissionMode).toBe('plan');
    // 只改 skills：general.json 内容完全不变，skills.json 写入
    saveSettings(configDir, home, { skills: [{ id: 's1', name: 'code-review', description: 'd', instructions: 'i' }] });
    expect(await readFile(join(configDir, 'general.json'), 'utf8')).toBe(generalBefore);
    expect(JSON.parse(await readFile(join(configDir, 'skills.json'), 'utf8')).skills).toHaveLength(1);
  });
  it('旧版单文件 settings.json 自动迁移为拆分文件', async () => {
    // 模拟旧版单一文件（含加密 providers 与各域字段）
    await writeFile(
      join(configDir, 'settings.json'),
      JSON.stringify({
        workingDirectory: '/old',
        permissionMode: 'auto-edit',
        onboardingDone: true,
        browsingEnabled: false,
        memory: [{ id: 'm1', content: '记忆' }],
        skills: [{ id: 's1', name: 'code-review', description: 'd', instructions: 'i' }]
      })
    );
    const s = loadSettings(configDir, home);
    expect(s.workingDirectory).toBe('/old');
    expect(s.permissionMode).toBe('auto-edit');
    expect(s.onboardingDone).toBe(true);
    expect(s.browsingEnabled).toBe(false);
    expect(s.memory).toEqual([{ id: 'm1', content: '记忆' }]);
    expect(s.skills).toEqual([{ id: 's1', name: 'code-review', description: 'd', instructions: 'i' }]);
    // 拆分文件已生成、旧文件改名 .bak
    expect(existsSync(join(configDir, 'general.json'))).toBe(true);
    expect(existsSync(join(configDir, 'memory.json'))).toBe(true);
    expect(existsSync(join(configDir, 'skills.json'))).toBe(true);
    expect(existsSync(join(configDir, 'settings.json'))).toBe(false);
    expect(existsSync(join(configDir, 'settings.json.bak'))).toBe(true);
  });

  it('非法 permissionMode 回退默认、其余字段保留', async () => {
    await writeFile(join(configDir, 'general.json'), JSON.stringify({ workingDirectory: '/x', permissionMode: 'evil', onboardingDone: true }));
    const s = loadSettings(configDir, home);
    expect(s.permissionMode).toBe('confirm');
    expect(s.workingDirectory).toBe('/x');
    expect(s.onboardingDone).toBe(true);
  });

  it('无 crypto 时明文落盘', async () => {
    const s = saveSettings(configDir, home, {
      providers: [{ id: 'p', name: 'P', baseUrl: 'https://x', apiKey: 'sk-secret', models: ['m1'] }]
    });
    expect(s.providers[0]?.apiKey).toBe('sk-secret');
    expect(await readFile(join(configDir, 'providers.json'), 'utf8')).toContain('sk-secret');
  });

  it('crypto 钩子：落盘加密、读回解密', async () => {
    const crypto: SettingsCrypto = {
      encrypt: p => 'ENC:' + p,
      decrypt: c => (c.startsWith('ENC:') ? c.slice(4) : c)
    };
    saveSettings(
      configDir,
      home,
      { providers: [{ id: 'p', name: 'P', baseUrl: 'https://x', apiKey: 'sk-secret', models: ['m1'] }] },
      crypto
    );
    const raw = await readFile(join(configDir, 'providers.json'), 'utf8');
    expect(raw).toContain('ENC:sk-secret');
    expect(raw).not.toContain('"sk-secret"');
    expect(loadSettings(configDir, home, crypto).providers[0]?.apiKey).toBe('sk-secret');
  });

  it('patch 合并：只更新传入字段', () => {
    saveSettings(configDir, home, { workingDirectory: '/a', permissionMode: 'plan' });
    const s = saveSettings(configDir, home, { workingDirectory: '/b' });
    expect(s.workingDirectory).toBe('/b');
    expect(s.permissionMode).toBe('plan');
  });

  it('deepseek 供应商 adapter 兜底、模型列表保留用户配置（空列表回退预置）', () => {
    const empty = saveSettings(configDir, home, {
      providers: [{ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: '', models: [] }]
    });
    expect(empty.providers[0]?.models).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash']);
    expect(empty.providers[0]?.adapter).toBe('deepseek');

    const custom = saveSettings(configDir, home, {
      providers: [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com',
          apiKey: '',
          models: ['deepseek-reasoner']
        }
      ]
    });
    expect(custom.providers[0]?.models).toEqual(['deepseek-reasoner']);
  });

  it('供应商推理/输出字段（thinking/reasoningEffort/maxTokens）落库读回', () => {
    saveSettings(configDir, home, {
      providers: [
        {
          id: 'p',
          name: 'P',
          baseUrl: 'https://x',
          apiKey: 'k',
          models: ['m1'],
          thinking: false,
          reasoningEffort: 'high',
          maxTokens: 256000,
          contextWindow: 1000000
        }
      ]
    });
    const loaded = loadSettings(configDir, home);
    expect(loaded.providers[0]?.thinking).toBe(false);
    expect(loaded.providers[0]?.reasoningEffort).toBe('high');
    expect(loaded.providers[0]?.maxTokens).toBe(256000);
    expect(loaded.providers[0]?.contextWindow).toBe(1000000);
  });

  it('供应商非法推理字段回退（畸形供应商整条被过滤）', () => {
    saveSettings(configDir, home, {
      providers: [
        {
          id: 'p',
          name: 'P',
          baseUrl: 'https://x',
          apiKey: 'k',
          models: ['m1'],
          thinking: 'yes',
          reasoningEffort: 'ultra',
          maxTokens: -5
        } as unknown as ProviderConfig
      ]
    });
    const loaded = loadSettings(configDir, home);
    expect(loaded.providers).toHaveLength(0);
  });

  it('commands 落库读回并过滤非法项', () => {
    const saved = saveSettings(configDir, home, {
      commands: [
        { id: 'c1', name: 'explain', description: '解释代码', prompt: '请解释以下代码：' },
        { id: 'bad', name: 1, description: 'x', prompt: 'y' }
      ]
    });
    expect(saved.commands).toHaveLength(1);
    expect(saved.commands[0]?.name).toBe('explain');
    expect(loadSettings(configDir, home).commands).toEqual([
      { id: 'c1', name: 'explain', description: '解释代码', prompt: '请解释以下代码：' }
    ]);
  });

  it('旧 builtin-compact（无 action）加载时迁移为动作命令', async () => {
    await writeFile(
      join(configDir, 'commands.json'),
      JSON.stringify({ commands: [{ id: 'builtin-compact', name: 'compact', description: '压缩', prompt: '旧提示词' }] })
    );
    const loaded = loadSettings(configDir, home);
    expect(loaded.commands.find(c => c.id === 'builtin-compact')?.action).toBe('compact');
  });

  it('memory 落库读回并过滤非法项', () => {
    const saved = saveSettings(configDir, home, {
      memory: [
        { id: 'm1', content: '本项目使用 pnpm' },
        { id: 'bad', content: 1 }
      ]
    });
    expect(saved.memory).toHaveLength(1);
    expect(saved.memory[0]?.content).toBe('本项目使用 pnpm');
    expect(loadSettings(configDir, home).memory).toEqual([{ id: 'm1', content: '本项目使用 pnpm' }]);
  });

  it('skills 落库读回并过滤非法项', () => {
    const saved = saveSettings(configDir, home, {
      skills: [
        { id: 's1', name: 'code-review', description: '代码审查', instructions: '审查代码并给出建议' },
        { id: 'bad', name: 1, description: 'x', instructions: 'y' }
      ]
    });
    expect(saved.skills).toHaveLength(1);
    expect(saved.skills[0]?.name).toBe('code-review');
  });

  it('hooks 落库读回并过滤非法 trigger', () => {
    const saved = saveSettings(configDir, home, {
      hooks: [
        { id: 'h1', name: 'format', trigger: 'tool_done', command: 'npm run format' },
        { id: 'bad', name: 'x', trigger: 'invalid', command: 'echo' }
      ]
    });
    expect(saved.hooks).toHaveLength(1);
    expect(saved.hooks[0]?.trigger).toBe('tool_done');
  });

  it('subagents 落库读回并过滤非法项', () => {
    const saved = saveSettings(configDir, home, {
      subagents: [
        { id: 'a1', name: 'reviewer', description: '代码审查', systemPrompt: '你是代码审查专家' },
        { id: 'bad', name: 1, description: 'x', systemPrompt: 'y' }
      ]
    });
    expect(saved.subagents).toHaveLength(1);
    expect(saved.subagents[0]?.name).toBe('reviewer');
  });

  it('无自定义 subagents 时预置默认子智能体', () => {
    const s = loadSettings(configDir, home);
    expect(s.subagents.length).toBeGreaterThan(0);
    expect(s.subagents.some(x => x.id === 'code-review')).toBe(true);
  });

  it('mcpServers 落库读回并过滤非法项', () => {
    const saved = saveSettings(configDir, home, {
      mcpServers: [
        { id: 'm1', name: 'filesystem', command: 'npx', args: ['-y', 'server'] },
        { id: 'bad', name: 'x', command: 1, args: [] }
      ]
    });
    expect(saved.mcpServers).toHaveLength(1);
    expect(saved.mcpServers[0]?.name).toBe('filesystem');
  });

  it('browsingEnabled 默认开启、可关闭并读回', () => {
    expect(loadSettings(configDir, home).browsingEnabled).toBe(true);
    expect(saveSettings(configDir, home, { browsingEnabled: false }).browsingEnabled).toBe(false);
    expect(loadSettings(configDir, home).browsingEnabled).toBe(false);
  });

  it('autoCompact 默认开启、阈值默认 80 且收敛到 50–95', () => {
    const fresh = defaultSettings(home);
    expect(fresh.autoCompact).toBe(true);
    expect(fresh.autoCompactThreshold).toBe(80);
    // 可关闭并读回
    expect(saveSettings(configDir, home, { autoCompact: false }).autoCompact).toBe(false);
    expect(loadSettings(configDir, home).autoCompact).toBe(false);
    // 阈值越界收敛：过低抬到 50、过高压到 95；非法值回退当前值
    expect(saveSettings(configDir, home, { autoCompactThreshold: 10 }).autoCompactThreshold).toBe(50);
    expect(saveSettings(configDir, home, { autoCompactThreshold: 99 }).autoCompactThreshold).toBe(95);
    expect(saveSettings(configDir, home, { autoCompactThreshold: 'bad' as unknown as number }).autoCompactThreshold).toBe(95);
  });
});

describe('sessions 持久化（JSONL：meta.json + session.jsonl）', () => {
  let dir: string;
  let rootDir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dscode-sessions-'));
    rootDir = join(dir, 'sessions');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // 每个用例独立根目录：JSONL 文件型存储不像 sqlite 可按 file 隔离，先清空再初始化
    await rm(rootDir, { recursive: true, force: true });
    initSessions(rootDir);
  });

  it('空根目录列表为空', () => {
    initSessions(rootDir);
    expect(listSessions(rootDir)).toEqual([]);
  });

  it('会话与消息落库读回（meta.json + session.jsonl）', () => {
    upsertSession(rootDir, makeSession('s1', '第一'));
    upsertMessage(rootDir, 's1', { id: 'm1', role: 'user', content: 'hi', createdAt: 300 });
    upsertMessage(rootDir, 's1', { id: 'm2', role: 'assistant', content: 'hello', createdAt: 400 });
    const list = listSessions(rootDir);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('s1');
    expect(list[0]?.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(list[0]?.toolEvents).toEqual([]);
    // 文件布局：<workspace-slug>/<session-id>/{meta.json, session.jsonl}
    expect(existsSync(join(rootDir, 'ws', 's1', 'meta.json'))).toBe(true);
    expect(existsSync(join(rootDir, 'ws', 's1', 'session.jsonl'))).toBe(true);
  });

  it('upsert 幂等：同 id 覆盖而非重复', () => {
    upsertSession(rootDir, makeSession('s2', 'a'));
    upsertSession(rootDir, makeSession('s2', 'b'));
    expect(listSessions(rootDir)).toHaveLength(1);
    expect(listSessions(rootDir)[0]?.title).toBe('b');
  });

  it('消息同 id 追加幂等：重写该行而非重复', () => {
    upsertSession(rootDir, makeSession('s3', 'a'));
    upsertMessage(rootDir, 's3', { id: 'm1', role: 'user', content: 'v1', createdAt: 1 });
    upsertMessage(rootDir, 's3', { id: 'm1', role: 'user', content: 'v2', createdAt: 1 });
    upsertMessage(rootDir, 's3', { id: 'm2', role: 'assistant', content: 'x', createdAt: 2 });
    const msgs = listSessions(rootDir).find(s => s.id === 's3')?.messages;
    expect(msgs?.map(m => m.content)).toEqual(['v2', 'x']);
  });

  it('消息 errorCode 可空且可选', () => {
    upsertSession(rootDir, makeSession('s4', 'a'));
    const withErr: Message = { id: 'm1', role: 'assistant', content: 'x', errorCode: 'api', createdAt: 1 };
    upsertMessage(rootDir, 's4', withErr);
    upsertMessage(rootDir, 's4', { id: 'm2', role: 'user', content: 'y', createdAt: 2 });
    const msgs = listSessions(rootDir).find(s => s.id === 's4')?.messages;
    expect(msgs?.[0]?.errorCode).toBe('api');
    expect(msgs?.[1]?.errorCode).toBeUndefined();
  });

  it('steps（思维链/工具/正文交错）落库读回且顺序保持', () => {
    upsertSession(rootDir, makeSession('s5', 'a'));
    const steps: AssistantStep[] = [
      { kind: 'reasoning', content: '先看看文件结构' },
      { kind: 'tool', event: { id: 'e1', name: 'read_file', args: '{"path":"a.ts"}', status: 'done', createdAt: 1 } },
      {
        kind: 'tool',
        event: {
          id: 'e2',
          name: 'write_file',
          args: '{"path":"b.ts"}',
          status: 'done',
          summary: '已写入',
          createdAt: 2
        }
      },
      { kind: 'text', content: '已完成' }
    ];
    upsertMessage(rootDir, 's5', { id: 'm1', role: 'assistant', content: '已完成', steps, createdAt: 3 });
    const msg = listSessions(rootDir).find(s => s.id === 's5')?.messages[0];
    expect(msg?.steps).toEqual(steps);
    expect(msg?.content).toBe('已完成');
  });

  it('无 steps 的老消息读回不带 steps（渲染端走正文兜底）', () => {
    upsertSession(rootDir, makeSession('s6', 'a'));
    upsertMessage(rootDir, 's6', { id: 'm1', role: 'assistant', content: '正文', createdAt: 1 });
    expect(listSessions(rootDir).find(s => s.id === 's6')?.messages[0]?.steps).toBeUndefined();
  });

  it('崩溃残留的非终态工具事件读回归一化为 error 并补说明', () => {
    upsertSession(rootDir, makeSession('s7', 'a'));
    const steps: AssistantStep[] = [
      {
        kind: 'tool',
        event: { id: 'e1', name: 'run_command', args: '{"command":"x"}', status: 'running', createdAt: 1 }
      },
      {
        kind: 'tool',
        event: {
          id: 'e2',
          name: 'edit_file',
          args: '{"path":"y"}',
          status: 'confirming',
          error: '用户未响应',
          createdAt: 2
        }
      }
    ];
    upsertMessage(rootDir, 's7', { id: 'm1', role: 'assistant', content: '', steps, createdAt: 3 });
    const events = listSessions(rootDir).find(s => s.id === 's7')?.messages[0]?.steps?.map(s => (s.kind === 'tool' ? s.event : null));
    expect(events?.[0]?.status).toBe('error');
    expect(events?.[0]?.error).toBe('会话中断，工具未完成');
    expect(events?.[1]?.status).toBe('error');
    expect(events?.[1]?.error).toBe('用户未响应');
  });

  it('session.jsonl 行损坏时跳过该行（不抛异常）', async () => {
    upsertSession(rootDir, makeSession('s8', 'a'));
    upsertMessage(rootDir, 's8', { id: 'm1', role: 'assistant', content: '正文', createdAt: 1 });
    await appendFile(join(rootDir, 'ws', 's8', 'session.jsonl'), 'not-json\n', 'utf8');
    upsertMessage(rootDir, 's8', { id: 'm2', role: 'user', content: 'ok', createdAt: 2 });
    const msgs = listSessions(rootDir).find(s => s.id === 's8')?.messages;
    expect(msgs?.map(m => m.content)).toEqual(['正文', 'ok']);
  });

  it('回复运行统计 stats 落库读回；无 stats 的消息不携带', () => {
    upsertSession(rootDir, makeSession('s9', 'a'));
    const stats = { startAt: 1000, endAt: 8000, firstTokenMs: 1200, promptTokens: 300, completionTokens: 402 };
    upsertMessage(rootDir, 's9', { id: 'm1', role: 'assistant', content: 'ok', stats, createdAt: 1 });
    upsertMessage(rootDir, 's9', { id: 'm2', role: 'user', content: 'hi', createdAt: 2 });
    const msgs = listSessions(rootDir).find(s => s.id === 's9')?.messages;
    expect(msgs?.[0]?.stats).toEqual(stats);
    expect(msgs?.[1]?.stats).toBeUndefined();
  });

  it('stats 缺失可选字段时读回仅含必填字段', () => {
    upsertSession(rootDir, makeSession('s10', 'a'));
    upsertMessage(rootDir, 's10', {
      id: 'm1',
      role: 'assistant',
      content: 'x',
      stats: { startAt: 1, endAt: 900 },
      createdAt: 1
    });
    const msg = listSessions(rootDir).find(s => s.id === 's10')?.messages[0];
    expect(msg?.stats).toEqual({ startAt: 1, endAt: 900 });
  });

  it('stats 字段损坏时读回无 stats（不抛异常）', () => {
    upsertSession(rootDir, makeSession('s11', 'a'));
    // 直接写坏 stats 字段的行
    const file = join(rootDir, 'ws', 's11', 'session.jsonl');
    appendFileSync(file, JSON.stringify({ id: 'm1', role: 'assistant', content: 'x', stats: { bad: true }, createdAt: 1 }) + '\n', 'utf8');
    const msg = listSessions(rootDir).find(s => s.id === 's11')?.messages[0];
    expect(msg?.stats).toBeUndefined();
    expect(msg?.content).toBe('x');
  });

  it('backfill 回填空工作目录并移入对应工作空间目录', () => {
    const s = makeSession('s12', 'a');
    s.workingDirectory = '';
    upsertSession(rootDir, s);
    expect(listSessions(rootDir).find(x => x.id === 's12')?.workingDirectory).toBe('');
    backfillSessions(rootDir, '/new-ws');
    const after = listSessions(rootDir).find(x => x.id === 's12');
    expect(after?.workingDirectory).toBe('/new-ws');
    // 目录已移到新工作空间 slug 下
    expect(existsSync(join(rootDir, 'new-ws', 's12', 'meta.json'))).toBe(true);
  });


  it('会话级运行统计随 meta 持久化：upsert 携带、setSessionStats 更新、读回恢复', () => {
    const stats1 = { rounds: 3, llmMs: 12000, toolMs: 800, firstTokenMsSum: 600, firstTokenCount: 3, promptTokens: 5000, completionTokens: 2000, cacheHits: 1, cacheMisses: 2, cacheHitTokens: 4000, cacheMissTokens: 1000, contextTokens: 6000, systemTokens: 500, toolsTokens: 1500, messagesTokens: 4000 };
    upsertSession(rootDir, { ...makeSession('s-stats', '统计'), stats: stats1 });
    expect(listSessions(rootDir).find(s => s.id === 's-stats')?.stats).toEqual(stats1);
    // getSessionStats 单会话读回（供宿主重启后回灌运行时，含上下文占用 contextTokens）
    expect(getSessionStats(rootDir, 's-stats')).toEqual(stats1);
    // setSessionStats 更新（运行结束时推送）
    const stats2 = { ...stats1, rounds: 4, llmMs: 15000 };
    setSessionStats(rootDir, 's-stats', stats2);
    expect(listSessions(rootDir).find(s => s.id === 's-stats')?.stats).toEqual(stats2);
    expect(getSessionStats(rootDir, 's-stats')).toEqual(stats2);
    // 无统计的会话不带 stats
    upsertSession(rootDir, makeSession('s-plain', '无统计'));
    expect(listSessions(rootDir).find(s => s.id === 's-plain')?.stats).toBeUndefined();
    expect(getSessionStats(rootDir, 's-plain')).toBeUndefined();
    // 不存在的会话返回 undefined
    expect(getSessionStats(rootDir, 's-nonexistent')).toBeUndefined();
  });
  it('归档标记落库读回：upsert 携带 archived，缺省未归档', () => {
    upsertSession(rootDir, makeSession('s13', '普通'));
    upsertSession(rootDir, { ...makeSession('s14', '已归档'), archived: true });
    const list = listSessions(rootDir);
    expect(list.find(s => s.id === 's13')?.archived).toBe(false);
    expect(list.find(s => s.id === 's14')?.archived).toBe(true);
  });

  it('setSessionArchived 归档/恢复，且 upsert 冲突更新不覆盖归档状态', () => {
    upsertSession(rootDir, makeSession('s15', 'a'));
    setSessionArchived(rootDir, 's15', true);
    expect(listSessions(rootDir).find(s => s.id === 's15')?.archived).toBe(true);
    // 常规会话落库（title 更新）不应把归档状态改回去
    upsertSession(rootDir, { ...makeSession('s15', 'b'), archived: false });
    expect(listSessions(rootDir).find(s => s.id === 's15')?.title).toBe('b');
    expect(listSessions(rootDir).find(s => s.id === 's15')?.archived).toBe(true);
    // 恢复
    setSessionArchived(rootDir, 's15', false);
    expect(listSessions(rootDir).find(s => s.id === 's15')?.archived).toBe(false);
  });

  it('旧版 sqlite sessions.db 自动迁移为 JSONL（读回一致、旧库改名 .bak）', async () => {
    const oldFile = join(rootDir, 'sessions.db');
    const db = new DatabaseSync(oldFile);
    db.exec(
      'CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, ' +
        "working_directory TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, " +
        'archived INTEGER NOT NULL DEFAULT 0)'
    );
    db.exec(
      'CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, ' +
        'content TEXT NOT NULL, error_code TEXT, steps TEXT, stats TEXT, created_at INTEGER NOT NULL)'
    );
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)').run('old-1', '旧会话', '/old-ws', 100, 200, 0);
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('m1', 'old-1', 'user', 'hi', null, null, null, 150);
    db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'm2',
      'old-1',
      'assistant',
      '完成',
      null,
      JSON.stringify([{ kind: 'text', content: '完成' }]),
      JSON.stringify({ startAt: 100, endAt: 500 }),
      160
    );
    db.close();
    initSessions(rootDir);
    const list = listSessions(rootDir);
    const s = list.find(x => x.id === 'old-1');
    expect(s?.title).toBe('旧会话');
    expect(s?.workingDirectory).toBe('/old-ws');
    expect(s?.messages.map(m => m.content)).toEqual(['hi', '完成']);
    expect(s?.messages[1]?.steps).toEqual([{ kind: 'text', content: '完成' }]);
    expect(s?.messages[1]?.stats).toEqual({ startAt: 100, endAt: 500 });
    // 旧库改名，不再出现在 sessions 列表数据里
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(oldFile + '.bak')).toBe(true);
    // 幂等：再次 init 不重复迁移
    initSessions(rootDir);
    expect(listSessions(rootDir).length).toBeGreaterThan(0);
  });

  it('不同根目录隔离', () => {
    const rootA = join(dir, 'iso-a');
    const rootB = join(dir, 'iso-b');
    initSessions(rootA);
    initSessions(rootB);
    upsertSession(rootA, makeSession('sa', '库A'));
    upsertSession(rootB, makeSession('sb', '库B'));
    expect(listSessions(rootA).map(s => s.id)).toEqual(['sa']);
    expect(listSessions(rootB).map(s => s.id)).toEqual(['sb']);
  });
});

describe('projects 持久化', () => {
  let dir: string;
  let file: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dscode-projects-'));
  });

  afterAll(async () => {
    // 先关闭 sqlite 连接再删目录：Windows 下未关闭的文件句柄会使 rm 失败（文件级测试失败的真凶）
    closeProjectsDbs();
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

  it('removeProject 移出侧边栏：list 排除、removed 返回、touch 重新打开恢复', () => {
    file = join(dir, 'remove.db');
    initProjects(file);
    touchProject(file, '/a/foo');
    touchProject(file, '/b/bar');
    removeProject(file, '/a/foo');
    expect(listProjects(file).map(p => p.name)).toEqual(['bar']);
    expect(listRemovedProjects(file).map(p => p.name)).toEqual(['foo']);
    // 重新打开撤销移除
    touchProject(file, '/a/foo');
    expect(listProjects(file).map(p => p.name)).toEqual(['foo', 'bar']);
    expect(listRemovedProjects(file)).toEqual([]);
  });

  it('removeProject 对不在最近表的项目补行记录移除状态', () => {
    file = join(dir, 'remove-fallback.db');
    initProjects(file);
    removeProject(file, '/c/ghost');
    expect(listProjects(file)).toEqual([]);
    expect(listRemovedProjects(file).map(p => p.name)).toEqual(['ghost']);
  });

  it('listProjectsWithHome 附带 homeDir 与 removed 列表', () => {
    file = join(dir, 'home.db');
    initProjects(file);
    touchProject(file, '/a/foo');
    removeProject(file, '/b/bar');
    const r = listProjectsWithHome(file, '/home/x');
    expect(r.homeDir).toBe('/home/x');
    expect(r.projects.map(p => p.name)).toEqual(['foo']);
    expect(r.removed.map(p => p.name)).toEqual(['bar']);
  });
});