/**
 * @dscode/ui 的全局类型声明：
 * *.vue 模块声明放在本包内（而不是只在 renderer 的 env.d.ts），
 * 使根 tsconfig.json（编辑器对 ui/shared 文件的默认项目）也能解析 .vue 导入。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
