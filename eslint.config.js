import { defineConfig } from '@soybeanjs/eslint-config-vue';

// 全局忽略必须在无 files 的独立 config 中声明（flat config 规范），
// soybean 的 ignores 放在带 files 的 config 里不生效，会扫到构建产物 out/
export default [
  {
    ignores: ['**/out/**', '**/dist/**', '**/release/**', '**/node_modules/**', '**/.zcode/**', '**/coverage/**']
  },
  ...(await defineConfig())
];
