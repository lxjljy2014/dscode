/// <reference types="vite/client" />

// *.vue 模块声明已移至 @dscode/ui 的 src/env.d.ts（供根 tsconfig 与 renderer 共用）

// Vite/electron-vite 在渲染端注入 process.env.NODE_ENV（开发 development / 构建 production），
// 与 import.meta.env.DEV 语义等价；显式声明以配合 boot.ts 的使用（tsconfig.web 未引入 node 类型）
declare const process: {
  env: {
    NODE_ENV?: 'development' | 'production';
  };
};
