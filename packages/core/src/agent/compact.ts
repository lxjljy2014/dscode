import type { Message } from '@dscode/shared';
import { estimateMessageTokens, estimateSystemTokens, estimateToolsTokens } from './token-estimate';

/**
 * 对话压缩（compact）纯逻辑：把较旧的一段对话浓缩为一份结构化摘要，替换为「检查点」用户消息，
 * 释放上下文。借鉴官方 harness compaction-basic 的指令结构与 checkpoint 前置说明，
 * 但适配 DSCode 的简单消息列表模型（无 surface/seq 概念）。
 */

/** 压缩时保留的最近消息条数（这些消息逐字保留，不参与摘要） */
export const RETAIN_MESSAGES = 3;

/** 摘要指令：作为摘要请求的系统提示词，让模型把上方对话浓缩为结构化检查点 */
export const COMPACT_INSTRUCTION = [
  '你是本 AI 编程助手的压缩引擎。把上面的对话压缩成一份结构化检查点，让另一个模型能够无损接续工作。',
  '',
  '严格按下面的 Markdown 结构输出：保留每个小节、按顺序排列。用简洁的要点而非长篇段落；空的小节写「（无）」——绝不要省略任何小节。',
  '',
  '## 主要请求与意图',
  "- [用户最初及演变的目标；确切的措辞需要逐字引用时逐字引用]",
  '',
  '## 关键技术概念',
  '- [涉及的技术、框架、模式与约定]',
  '',
  '## 文件与代码',
  '- [准确路径：为何重要、关键改动或片段]',
  '',
  '## 错误与修复',
  '- [错误：如何解决，以及相关的用户反馈]',
  '',
  '## 待办工作',
  '- [明确要求但尚未完成的工作]',
  '',
  '## 当前进展',
  '- [当前检查点正在做什么]',
  '',
  '## 下一步',
  '- [紧随最近请求的单个下一步动作，或「（无）」]',
  '',
  '## 关键上下文',
  '- [决策及理由、约束、用户偏好、待解问题、继续所需的数据]',
  '',
  '规则：',
  '- 用简洁的中文工程语言。保留准确的文件路径、命令、错误字符串、标识符、数值、函数签名与语法片段。',
  '- 忠实记录用户反馈与明确指令，尤其是纠正。',
  '- 不要提及本次摘要请求，也不要提上下文被压缩过。',
  '- 只输出检查点正文：不要调用任何工具或做其它事。',
  '- 若对话中已存在一份检查点，不要逐字复制它：保留仍然成立的事实、丢弃过时内容，把更新的信息合并到同一结构下。'
].join('\n');

/** 检查点落地后的前置说明：把摘要标记为「已建立的背景」 */
export const CHECKPOINT_PREAMBLE =
  '这是自动生成的检查点，浓缩了对话中较早的一段以释放上下文。把其中的内容视为已建立的背景，在其基础上继续，不要复述。直接从后续消息继续任务，不要回应本检查点。';

/** 可压缩范围（含首尾下标）；保留最近 RETAIN_MESSAGES 条，压缩更早的全部消息 */
export interface CompactRange {
  start: number;
  end: number;
}

/** 选择可压缩范围：历史不足时返回 null */
export function selectCompactableRange(messages: readonly Message[], retain = RETAIN_MESSAGES): CompactRange | null {
  if (messages.length <= retain) return null;
  return { start: 0, end: messages.length - retain - 1 };
}

/**
 * 构造摘要请求：system = 摘要指令，messages = 被压缩的旧 span（原样 user/assistant）。
 * 返回完整请求上下文（含 system 首条），宿主直接传给流式聊天。
 */
export function buildCompactionRequest(messages: readonly Message[], range: CompactRange): unknown[] {
  const span = messages.slice(range.start, range.end + 1).map(m => ({ role: m.role, content: m.content }));
  return [{ role: 'system', content: COMPACT_INSTRUCTION }, ...span];
}

/** 用摘要替换旧 span，返回新的消息列表（检查点作为用户消息落在被压缩位置） */
export function applyCompaction(
  messages: readonly Message[],
  range: CompactRange,
  summary: string,
  checkpointId: string,
): Message[] {
  const checkpoint: Message = {
    id: checkpointId,
    role: 'user',
    content: CHECKPOINT_PREAMBLE + '\n\n' + summary,
    createdAt: Date.now()
  };
  return [...messages.slice(0, range.start), checkpoint, ...messages.slice(range.end + 1)];
}

/** 上下文占用投影：与运行时 ContextMeter 的构成口径一致（system + tools + messages） */
export interface ContextProjection {
  contextTokens: number;
  systemTokens: number;
  toolsTokens: number;
  messagesTokens: number;
}

/**
 * 压缩后估算新的上下文占用：压缩释放了旧消息但短期内不会再发起 agent 运行，
 * 由宿主用与运行时相同的估算函数对压缩后消息算一遍投影，让 ContextMeter 立即回落。
 * 近似口径：messages 按持久化消息的 role+content 估算（工具调用重建细节不计入），
 * 下一次真实运行的 usage.promptTokens 会重新锚定精确值。
 */
export function estimateContextProjection(
  systemPrompt: string,
  tools: unknown[],
  messages: readonly Message[]
): ContextProjection {
  const systemTokens = estimateSystemTokens(systemPrompt);
  const toolsTokens = estimateToolsTokens(tools);
  const messagesTokens = messages.reduce(
    (sum, m) => sum + estimateMessageTokens({ role: m.role, content: m.content }),
    0
  );
  return { contextTokens: systemTokens + toolsTokens + messagesTokens, systemTokens, toolsTokens, messagesTokens };
}
