import { createVuetify } from 'vuetify'
import { aliases, lucide } from 'vuetify/iconsets/lucide'
import { en, zhHans } from 'vuetify/locale'
import 'vuetify/styles'
import { darkTheme, lightTheme } from '../theme/tokens'

/**
 * Vuetify 4 配置：
 * - icons：官方 UnoCSS iconsets 方案集成 Lucide（依赖 @iconify-json/lucide + presetIcons）
 * - theme：双主题 + 语义变量（边框、hover 等全局微调）
 * - defaults：全局组件预设，细边框 + 圆角 + 去阴影的统一气质
 */
export function createVuetifyPlugin() {
  return createVuetify({
    icons: {
      defaultSet: 'lucide',
      aliases,
      sets: { lucide }
    },
    locale: {
      locale: 'zhHans',
      fallback: 'en',
      messages: { zhHans, en }
    },
    theme: {
      defaultTheme: 'dark',
      themes: {
        light: lightTheme,
        dark: darkTheme
      },
      variations: {
        colors: [],
        lighten: 0,
        darken: 0
      }
    },
    defaults: {
      VBtn: {
        variant: 'flat',
        rounded: 'lg'
      },
      VIconBtn: {
        variant: 'text',
        rounded: 'lg',
        size: 'small',
      },
      VBtnToggle: {
        rounded: 'lg'
      },
      VCard: {
        flat: true,
        border: true,
        rounded: 'lg'
      },
      VTextField: {
        variant: 'outlined',
        density: 'compact',
        rounded: 'lg',
        hideDetails: true
      },
      VTextarea: {
        variant: 'outlined',
        rounded: 'lg',
        hideDetails: true
      },
      VList: {
        density: 'compact',
        prependGap: 8
      },
      VListItem: {
        rounded: 'lg',
        VIcon: {
          size: 'small',
        }
      },
      VAppBar: {
        flat: true
      },
      VFooter: {
        app: false
      },
      VMenu: {
        rounded: 'lg'
      },
      VTooltip: {
        rounded: 'md'
      },
      VTabs: {
        density: 'compact',
        hideSlider: false
      },
      VTab: {
        rounded: 'md'
      },
      VChip: {
        rounded: 'md',
        size: 'small'
      },
      VEmptyState: {
        size: 'large'
      }
    }
  })
}
