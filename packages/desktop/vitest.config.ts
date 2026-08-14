import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// desktop 单测只覆盖主进程纯逻辑（validators / settings）。
// settings.ts 会 value-import @dscode/core，这里用别名直接指向 TS 源码，
// 避免依赖 vite 对 workspace 包子路径（exports 指向 .ts）的解析差异。
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@dscode\/core$/, replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
      { find: /^@dscode\/shared$/, replacement: fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
      {
        find: /^@dscode\/shared\/settings$/,
        replacement: fileURLToPath(new URL('../shared/src/types/settings.ts', import.meta.url))
      }
    ]
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
});
