/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

// Vite/electron-vite 在渲染端注入 process.env.NODE_ENV（开发 development / 构建 production），
// 与 import.meta.env.DEV 语义等价；显式声明以配合 boot.ts 的使用（tsconfig.web 未引入 node 类型）
declare const process: {
  env: {
    NODE_ENV?: 'development' | 'production';
  };
};
