// 物理 re-export：部分 IDE 的 TS 服务不解析 package.json exports 的子路径，
// 此文件让 `@dscode/ui/tokens` 经目录查找也能命中，与 src/theme/tokens.ts 同一来源。
export * from './src/theme/tokens';
