import { defineConfig, presetIcons } from 'unocss';
import presetWind4 from '@unocss/preset-wind4';
import { fontFamilyMono, fontFamilySans, unoColors } from '@dscode/ui/tokens';

export default defineConfig({
  // 代码块 header 的复制/下载/对勾图标仅在 markdown.ts 字符串里出现，
  // 显式加入 safelist 保证被生成（避免依赖扫描 .ts 字符串的不确定性）；
  // 文件类型图标（file-code/json/image/palette/settings）一并列入保险
  safelist: [
    'i-lucide:copy', 'i-lucide:download', 'i-lucide:check',
    'i-lucide:file-code', 'i-lucide:file-code-2', 'i-lucide:file-json',
    'i-lucide:file-image', 'i-lucide:palette', 'i-lucide:settings'
  ],
  presets: [
    // 关闭 reset 预检，避免与 Vuetify 自带 reset 双重重置
    presetWind4({ preflights: { reset: false } }),
    // Vuetify 官方文档要求：保留默认 i- 前缀，并删除 color 属性
    presetIcons({
      processor(props) {
        delete props.color;
      }
    })
  ],
  theme: {
    // 颜色全部引用 Vuetify CSS 变量，随主题切换自动变化
    colors: unoColors,
    fontFamily: {
      sans: fontFamilySans,
      mono: fontFamilyMono
    }
  }
});
