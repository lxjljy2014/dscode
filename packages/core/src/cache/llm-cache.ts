import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { AgentToolName, LlmCacheStats } from '@dscode/shared';

/**
 * LLM 回复缓存（省成本）：对「模型 + 消息序列 + 工具 schema」做确定性哈希为 key，
 * 命中则重放缓存的响应（文本/思维链/工具调用），不再调用 API。
 *
 * 命中场景：相同问题重发、运行中断后重试（历史上下文可复现）、fork 会话、跨会话相同问题。
 * 缓存命中后工具调用仍走权限门控（写/执行需确认），安全网不变。
 *
 * runtime 只依赖本接口（纯逻辑层不碰 node:crypto/sqlite）；sqlite 实现由桌面壳注入。
 */

/** 缓存的单次 LLM 响应 */
export interface LlmCacheEntry {
  /** 正文文本（缓存命中时按流式推送） */
  content: string;
  /** 思维链文本（若有） */
  reasoning: string;
  /** 模型发起的工具调用（命中后进入正常工具循环） */
  toolCalls: { id: string; name: AgentToolName; arguments: string }[];
  promptTokens: number;
  completionTokens: number;
}

/** 缓存访问接口（runtime 注入，desktop 提供 sqlite 实现） */
export interface LlmCache {
  /** 请求缓存 key（实现自备哈希；messages 为运行时上下文，tools 为工具 schema） */
  key(model: string, messages: unknown[], tools: unknown[]): string;
  get(key: string): Promise<LlmCacheEntry | null>;
  set(key: string, entry: LlmCacheEntry): Promise<void>;
  /** 命中：记录节省的 token（按缓存记录计） */
  recordHit(model: string, savedPrompt: number, savedCompletion: number): Promise<void>;
  recordMiss(model: string): Promise<void>;
  stats(): Promise<LlmCacheStats>;
  clear(): Promise<LlmCacheStats>;
}

/** 缓存条目数上限：超出后清理最旧 20%（防止无限增长） */
const MAX_ENTRIES = 2000;

const dbs = new Map<string, DatabaseSync>();

function getDb(file: string): DatabaseSync {
  let db = dbs.get(file);
  if (!db) {
    db = new DatabaseSync(file);
    db.exec(
      'CREATE TABLE IF NOT EXISTS llm_cache_entries (' +
        'key TEXT PRIMARY KEY, ' +
        'model TEXT NOT NULL, ' +
        'content TEXT NOT NULL, ' +
        'reasoning TEXT NOT NULL, ' +
        'tool_calls TEXT NOT NULL, ' +
        'prompt_tokens INTEGER NOT NULL, ' +
        'completion_tokens INTEGER NOT NULL, ' +
        'created_at INTEGER NOT NULL)'
    );
    db.exec(
      'CREATE TABLE IF NOT EXISTS llm_cache_stats (' +
        'model TEXT PRIMARY KEY, ' +
        'hits INTEGER NOT NULL, ' +
        'misses INTEGER NOT NULL, ' +
        'saved_prompt INTEGER NOT NULL, ' +
        'saved_completion INTEGER NOT NULL)'
    );
    dbs.set(file, db);
  }
  return db;
}

/** 确定性缓存 key：sha256(model + 消息序列 + 工具 schema)，消息/工具结构变化即 miss */
export function buildCacheKey(model: string, messages: unknown[], tools: unknown[]): string {
  const digest = createHash('sha256')
    .update(model + '\u0000' + JSON.stringify(messages) + '\u0000' + JSON.stringify(tools))
    .digest('hex');
  return `llm:${model}:${digest}`;
}

/** 创建 sqlite 版 LLM 缓存（node:sqlite，无原生依赖） */
export function createSqliteLlmCache(file: string, maxEntries = MAX_ENTRIES): LlmCache {
  return {
    key: (model, messages, tools) => buildCacheKey(model, messages, tools),

    async get(key: string): Promise<LlmCacheEntry | null> {
      const row = getDb(file)
        .prepare(
          'SELECT content, reasoning, tool_calls, prompt_tokens, completion_tokens FROM llm_cache_entries WHERE key = ?'
        )
        .get(key) as
        | { content: string; reasoning: string; tool_calls: string; prompt_tokens: number; completion_tokens: number }
        | undefined;
      if (!row) return null;
      try {
        return {
          content: row.content,
          reasoning: row.reasoning,
          toolCalls: JSON.parse(row.tool_calls) as { id: string; name: AgentToolName; arguments: string }[],
          promptTokens: row.prompt_tokens,
          completionTokens: row.completion_tokens
        };
      } catch {
        return null;
      }
    },

    async set(key: string, entry: LlmCacheEntry): Promise<void> {
      const db = getDb(file);
      db.prepare(
        'INSERT OR REPLACE INTO llm_cache_entries (key, model, content, reasoning, tool_calls, prompt_tokens, completion_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        key,
        '',
        entry.content,
        entry.reasoning,
        JSON.stringify(entry.toolCalls),
        entry.promptTokens,
        entry.completionTokens,
        Date.now()
      );
      // 容量控制：超出上限删除最旧 20%
      const count = (db.prepare('SELECT COUNT(*) AS c FROM llm_cache_entries').get() as { c: number }).c;
      if (count > maxEntries) {
        const drop = Math.ceil(maxEntries * 0.2);
        db.prepare(
          'DELETE FROM llm_cache_entries WHERE key IN (SELECT key FROM llm_cache_entries ORDER BY created_at ASC LIMIT ?)'
        ).run(drop);
      }
    },

    async recordHit(model: string, savedPrompt: number, savedCompletion: number): Promise<void> {
      getDb(file)
        .prepare(
          'INSERT INTO llm_cache_stats (model, hits, misses, saved_prompt, saved_completion) VALUES (?, 1, 0, ?, ?) ON CONFLICT(model) DO UPDATE SET hits = hits + 1, saved_prompt = saved_prompt + excluded.saved_prompt, saved_completion = saved_completion + excluded.saved_completion'
        )
        .run(model, savedPrompt, savedCompletion);
    },

    async recordMiss(model: string): Promise<void> {
      getDb(file)
        .prepare(
          'INSERT INTO llm_cache_stats (model, hits, misses, saved_prompt, saved_completion) VALUES (?, 0, 1, 0, 0) ON CONFLICT(model) DO UPDATE SET misses = misses + 1'
        )
        .run(model);
    },

    async stats(): Promise<LlmCacheStats> {
      const db = getDb(file);
      const s = db
        .prepare(
          'SELECT COALESCE(SUM(hits), 0) AS hits, COALESCE(SUM(misses), 0) AS misses, COALESCE(SUM(saved_prompt), 0) AS saved_prompt, COALESCE(SUM(saved_completion), 0) AS saved_completion FROM llm_cache_stats'
        )
        .get() as { hits: number; misses: number; saved_prompt: number; saved_completion: number };
      const entries = (db.prepare('SELECT COUNT(*) AS c FROM llm_cache_entries').get() as { c: number }).c;
      const total = s.hits + s.misses;
      return {
        hits: s.hits,
        misses: s.misses,
        hitRate: total > 0 ? s.hits / total : 0,
        savedPromptTokens: s.saved_prompt,
        savedCompletionTokens: s.saved_completion,
        entries
      };
    },

    async clear(): Promise<LlmCacheStats> {
      const db = getDb(file);
      db.exec('DELETE FROM llm_cache_entries; DELETE FROM llm_cache_stats;');
      return this.stats();
    }
  };
}

/** 初始化缓存文件（建表） */
export function initLlmCache(file: string): void {
  getDb(file);
}
