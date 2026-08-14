import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from '@dscode/shared';

/**
 * 插件系统（最小实现）：扫描 userData/plugins 目录下的 .mjs 模块，
 * 动态 import 其默认导出，校验后作为插件集合返回。插件可贡献斜杠命令。
 * 加载失败/非法插件仅告警，不阻断主流程。
 */

function isPlugin(v: unknown): v is Plugin {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (typeof p['id'] !== 'string' || typeof p['name'] !== 'string' || typeof p['description'] !== 'string') {
    return false;
  }
  if (p['commands'] !== undefined) {
    if (!Array.isArray(p['commands'])) return false;
    for (const c of p['commands'] as unknown[]) {
      if (typeof c !== 'object' || c === null) return false;
      const cc = c as Record<string, unknown>;
      if (typeof cc['id'] !== 'string' || typeof cc['name'] !== 'string' || typeof cc['prompt'] !== 'string') {
        return false;
      }
    }
  }
  return true;
}

/** 扫描并加载指定目录下的插件 */
export async function loadPlugins(dir: string): Promise<Plugin[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const plugins: Plugin[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.mjs')) continue;
    try {
      const mod = await import(pathToFileURL(join(dir, entry)).href);
      const candidate = (mod.default ?? mod) as unknown;
      if (isPlugin(candidate)) plugins.push(candidate);
      else console.warn('[plugins] 跳过非法插件 ' + entry);
    } catch (e) {
      console.warn('[plugins] 加载 ' + entry + ' 失败:', e instanceof Error ? e.message : String(e));
    }
  }
  return plugins;
}

const cache = new Map<string, { at: number; plugins: Plugin[] }>();

/** 带缓存的插件获取（避免每次 agent 启动都重新读盘/import） */
export async function getPlugins(dir: string, ttlMs = 5000): Promise<Plugin[]> {
  const cached = cache.get(dir);
  if (cached && Date.now() - cached.at < ttlMs) return cached.plugins;
  const plugins = await loadPlugins(dir);
  cache.set(dir, { at: Date.now(), plugins });
  return plugins;
}
