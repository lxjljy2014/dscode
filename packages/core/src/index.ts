// @dscode/core 统一出口：纯 TS 核心逻辑（agent 运行时/工具/门控/模型适配/工作区/diff/git/持久化）。
// 桌面端与将来的 TUI 端在 Node 环境直接复用；web 端复用其中的纯逻辑层（无 Node 依赖的部分）。
export * from './adapters';
export * from './constants';
export * from './agent/runtime';
export * from './agent/token-estimate';
export * from './agent/compact';
export * from './cache/llm-cache';
export * from './agent/types';
export * from './gate/gate';
export * from './mcp/client';
export * from './git/git';
export * from './persist/config';
export * from './persist/projects';
export * from './persist/provider';
export * from './persist/sessions';
export * from './persist/usage';
export * from './plugins/loader';
export * from './net/ssrf';
export * from './tools';
export * from './code-run/run-code';
export { createRunCodeWorker } from './code-run/worker';
export * from './tools/types';
export * from './workspace/diff';
export * from './workspace/paths';
export * from './workspace/index';
export * from './workspace/workspace';