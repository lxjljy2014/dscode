import { defineConfig, presetIcons } from 'unocss'
import presetWind4 from '@unocss/preset-wind4'
import { fontFamilyMono, fontFamilySans, unoColors } from '@dscode/ui/tokens'

export default defineConfig({
  presets: [
    // 关闭 reset 预检，避免与 Vuetify 自带 reset 双重重置
    presetWind4({ preflights: { reset: false } }),
    // Vuetify 官方文档要求：保留默认 i- 前缀，并删除 color 属性
    presetIcons({
      processor(props) {
        delete props.color
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
})
