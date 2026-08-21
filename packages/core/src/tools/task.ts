import { defineTool } from './schema';
import type { ToolResult } from './types';

/**
 * 子任务派发工具：主 agent 把独立探索/调研类工作委派给一个只读子任务——
 * 子任务以独立上下文窗口运行（读文件/搜索/浏览），完成后仅把结论摘要带回主上下文，
 * 中间过程不占用主任务预算。工具本体是纯薄壳，实际派发由运行时注入的
 * spawnSubagent 完成（子任务需要 provider/LLM 环境与父运行的取消联动）。
 */
export const taskTool = defineTool({
  name: 'task',
  // 子任务仅只读工具集，无需确认；串行执行（子任务跑完整 LLM 循环，耗时远超普通工具）
  permission: 'read',
  concurrency: 'exclusive',
  // 子任务整体兜底超时（单轮 LLM 5 分钟 × 轮次的最坏情况封顶）
  timeoutMs: 10 * 60_000,
  description:
    '派发子任务：以独立上下文窗口运行只读工具循环（读文件/搜索/浏览），完成后仅返回结论摘要，中间过程不占用当前上下文。适合大范围代码探索、独立调研；需要修改文件时请主任务自行执行，不要交给子任务',
  presentation: {
    presentCall: args => ({
      card: 'generic',
      title: `子任务：${typeof args.description === 'string' ? args.description : ''}`
    })
  },
  parameters: {
    description: { type: 'string', description: '任务简述（一句话，供展示）', required: true },
    prompt: { type: 'string', description: '完整任务指令：目标、范围、期望的结论形式', required: true },
    subagent: { type: 'string', description: '子智能体名或 id（设置页配置的人设；缺省通用探索者）' }
  },
  async execute(args, ctx): Promise<ToolResult> {
    if (!ctx.spawnSubagent) return { ok: false, error: '当前运行环境不支持子任务派发' };
    const r = await ctx.spawnSubagent(
      {
        description: args.description,
        prompt: args.prompt,
        ...(args.subagent ? { subagent: args.subagent } : {})
      },
      ctx.signal
    );
    return r.ok ? { ok: true, content: r.content } : { ok: false, error: r.content };
  }
});
