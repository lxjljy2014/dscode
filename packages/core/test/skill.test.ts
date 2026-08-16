import { describe, expect, it } from 'vitest';
import { DEFAULT_SKILLS } from '@dscode/shared';
import { executeTool, skillCatalogSection, toolSchemas, toolConcurrencyOf } from '../src/tools';

/** 技能目录 + skill 工具：目录注入提示词、按需加载完整指令（借鉴官方 harness dsh-tool-skill） */
describe('skillCatalogSection（系统提示词的技能目录）', () => {
  it('空列表返回空串（提示词不变）', () => {
    expect(skillCatalogSection([])).toBe('');
  });

  it('只含名称与一句话说明，不含指令正文', () => {
    const section = skillCatalogSection(DEFAULT_SKILLS);
    expect(section).toContain('code-review：');
    expect(section).toContain('debugging：');
    // 目录不泄露正文：指令中的特征词不应出现在目录里
    expect(section).not.toContain('按严重程度从高到低');
    expect(section).not.toContain('先测量，后优化');
    // 指引模型先加载再执行
    expect(section).toContain('skill 工具');
  });
});

describe('skill 工具（按名加载完整指令）', () => {
  it('命中：返回名称/说明/完整指令', async () => {
    const r = await executeTool('skill', JSON.stringify({ name: 'code-review' }), '/tmp', {
      skills: DEFAULT_SKILLS
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.content).toContain('【技能 code-review】');
      expect(r.content).toContain('按严重程度从高到低逐条列出问题');
      expect(r.meta?.['skill']).toBe('code-review');
    }
  });

  it('未命中：结构化错误并列出可用技能', async () => {
    const r = await executeTool('skill', JSON.stringify({ name: 'nope' }), '/tmp', { skills: DEFAULT_SKILLS });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('未知技能: nope');
      expect(r.error).toContain('code-review');
    }
  });

  it('无技能列表：错误提示当前无可用技能', async () => {
    const r = await executeTool('skill', JSON.stringify({ name: 'code-review' }), '/tmp');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('当前无可用技能');
  });

  it('缺必填 name：参数校验失败', async () => {
    const r = await executeTool('skill', '{}', '/tmp', { skills: DEFAULT_SKILLS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('缺少参数 name');
  });
});

describe('skill 工具注册与暴露', () => {
  it('注册为只读并行工具（无确认、可并行）', () => {
    expect(toolConcurrencyOf('skill')).toBe('parallel');
  });

  it('默认 schema 包含 skill；includeSkill=false 时排除', () => {
    const names = (toolSchemas(true, false) as Array<{ function: { name: string } }>).map(s => s.function.name);
    expect(names).toContain('skill');
    const filtered = (toolSchemas(true, false, false) as Array<{ function: { name: string } }>).map(s => s.function.name);
    expect(filtered).not.toContain('skill');
  });

  it('Code Mode 下只暴露 run_code（skill 也不暴露）', () => {
    const names = (toolSchemas(true, true) as Array<{ function: { name: string } }>).map(s => s.function.name);
    expect(names).toEqual(['run_code']);
  });
});
