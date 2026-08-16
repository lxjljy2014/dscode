/**
 * skill 工具 + 技能目录（借鉴官方 harness dsh-tool-skill 的「目录注入 + 按需加载」设计）：
 * - 系统提示词只注入技能目录（名称 + 一句话说明），模型判断任务与某技能相关时，
 *   先调用 skill 工具加载该技能完整指令再执行——避免把全部指令塞进提示词（省 token、提升相关性）。
 * - skill 工具按名称精确查找本次运行传入的技能列表（ToolContext.skills），返回完整指令。
 * 技能数据由宿主（desktop settings）持久化并经 AgentStartInput.config.skills 传入运行时，
 * 再经工具批调度透传到工具上下文；core 不持有技能存储，只消费运行时注入的列表。
 */

import type { Skill } from '@dscode/shared';
import { defineTool } from './schema';
import type { ToolResult } from './types';

/**
 * 生成系统提示词的技能目录段落（名称 + 一句话说明，不含正文）。
 * 空列表返回空串（保持提示词不变）；目录行提示模型先调用 skill 工具加载完整说明。
 */
export function skillCatalogSection(skills: Skill[]): string {
  if (skills.length === 0) return '';
  return (
    '\n\n可用技能（任务与某技能相关时，先调用 skill 工具加载该技能完整指令，再按其步骤执行）：\n' +
    skills.map(s => `- ${s.name}：${s.description}`).join('\n')
  );
}

/** skill 工具：按名称加载技能完整说明（只读、无副作用，可并行） */
export const skillTool = defineTool({
  name: 'skill',
  permission: 'read',
  concurrency: 'parallel',
  description:
    '加载一个可用技能的完整操作说明（技能名称见系统提示中的技能目录）。' +
    '任务与某技能相关时，先调用本工具获取完整指令，再按指令步骤执行。',
  parameters: {
    name: { type: 'string', description: '技能名称（如 code-review，见系统提示的技能目录）', required: true },
  },
  execute(args, ctx): ToolResult {
    const skills = ctx.skills ?? [];
    const skill = skills.find(s => s.name === args.name);
    if (!skill) {
      const available = skills.length > 0 ? skills.map(s => s.name).join('、') : '（当前无可用技能）';
      return { ok: false, error: `未知技能: ${args.name}；可用技能：${available}` };
    }
    return {
      ok: true,
      content: `【技能 ${skill.name}】${skill.description}\n\n${skill.instructions}`,
      // meta 供 UI 徽章展示；blocks 供展开区渲染指令正文
      meta: { skill: skill.name },
      blocks: [{ type: 'text', text: skill.instructions }],
    };
  },
});
