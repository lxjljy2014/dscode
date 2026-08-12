import type { ThemeDefinition } from 'vuetify'

/**
 * 中性色阶（唯一事实源）。
 * 语义 token 只引用色阶，Vuetify 负责生成 `--v-theme-*` CSS 变量，
 * UnoCSS 颜色再映射到这些变量，保证组件与工具类颜色始终一致。
 */
export const neutral = {
  50: '#fafafa',
  100: '#f5f5f5',
  200: '#eeeeee',
  300: '#e0e0e0',
  400: '#bdbdbd',
  500: '#8f8f8f',
  600: '#5d5d5d',
  700: '#424242',
  800: '#2a2a2a',
  850: '#212121',
  900: '#171717',
  925: '#121212',
  950: '#0d0d0d'
} as const

export const lightTheme: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#ffffff',
    'on-background': neutral[900],
    surface: neutral[100],
    'on-surface': neutral[900],
    'surface-variant': neutral[200],
    'on-surface-variant': neutral[600],
    primary: neutral[900],
    'on-primary': '#ffffff',
    secondary: neutral[600],
    'on-secondary': '#ffffff',
    success: '#1a7f37',
    'on-success': '#ffffff',
    error: '#cf222e',
    'on-error': '#ffffff',
    info: neutral[600],
    warning: '#9a6700'
  },
  variables: {
    'border-color': neutral[900],
    'border-opacity': 0.09,
    'hover-opacity': 0.05,
    'activated-opacity': 0.09,
    'focus-opacity': 0.12,
    'pressed-opacity': 0.12,
    'dragged-opacity': 0.08,
    'disabled-opacity': 0.38,
    'high-emphasis-opacity': 0.9,
    'medium-emphasis-opacity': 0.6,
    'idle-opacity': 0.04
  }
}

export const darkTheme: ThemeDefinition = {
  dark: true,
  colors: {
    background: neutral[950],
    'on-background': '#ececec',
    surface: neutral[900],
    'on-surface': '#ececec',
    'surface-variant': neutral[850],
    'on-surface-variant': neutral[400],
    primary: '#ececec',
    'on-primary': neutral[900],
    secondary: '#a3a3a3',
    'on-secondary': neutral[900],
    success: '#3fb950',
    'on-success': neutral[950],
    error: '#f47067',
    'on-error': neutral[950],
    info: '#a3a3a3',
    warning: '#d29922'
  },
  variables: {
    'border-color': '#ffffff',
    'border-opacity': 0.08,
    'hover-opacity': 0.06,
    'activated-opacity': 0.1,
    'focus-opacity': 0.14,
    'pressed-opacity': 0.14,
    'dragged-opacity': 0.08,
    'disabled-opacity': 0.38,
    'high-emphasis-opacity': 0.9,
    'medium-emphasis-opacity': 0.6,
    'idle-opacity': 0.06
  }
}

/**
 * UnoCSS 颜色 → Vuetify CSS 变量。
 * Vuetify 变量值为 `R,G,B` 三元组，可用 `rgb(var(--v-theme-x))` 或带 alpha 使用。
 */
export const unoColors = {
  base: 'rgb(var(--v-theme-background))',
  surface: 'rgb(var(--v-theme-surface))',
  elevated: 'rgb(var(--v-theme-surface-variant))',
  fg: 'rgb(var(--v-theme-on-surface))',
  muted: 'rgba(var(--v-theme-on-surface), 0.6)',
  faint: 'rgba(var(--v-theme-on-surface), 0.4)',
  line: 'rgba(var(--v-theme-on-surface), 0.09)',
  'line-strong': 'rgba(var(--v-theme-on-surface), 0.18)',
  primary: 'rgb(var(--v-theme-primary))',
  'on-primary': 'rgb(var(--v-theme-on-primary))',
  'diff-add': '#2da44e',
  'diff-del': '#cf222e'
} as const

export const fontFamilySans =
  "'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"

export const fontFamilyMono =
  "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
