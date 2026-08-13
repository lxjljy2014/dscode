import type { ThemeDefinition } from 'vuetify';

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
} as const;

/**
 * 语法高亮色板（markdown 代码块用，light/dark 各一套，key 带 `syntax-` 前缀）。
 * 挂进 Vuetify theme colors 后生成 `--v-theme-syntax-*` CSS 变量，global.css 的 .hljs-* 引用。
 * 色值参考 GitHub 明暗配色，语义对齐上方语义色（红=错误/关键字、绿=字符串、蓝=类型）。
 */
export const syntaxPalette = {
  light: {
    'syntax-comment': neutral[500],
    'syntax-string': '#0a3069',
    'syntax-number': '#953800',
    'syntax-keyword': '#cf222e',
    'syntax-function': '#8250df',
    'syntax-title': '#0550ae',
    'syntax-variable': neutral[900],
    'syntax-tag': '#116329',
    'syntax-attr': '#0550ae',
    'syntax-literal': '#0550ae',
    'syntax-meta': '#57606a',
    'syntax-bg': '#f6f8fa'
  },
  dark: {
    'syntax-comment': neutral[500],
    'syntax-string': '#7ee787',
    'syntax-number': '#f2cc60',
    'syntax-keyword': '#ff7b72',
    'syntax-function': '#d2a8ff',
    'syntax-title': '#79c0ff',
    'syntax-variable': '#ececec',
    'syntax-tag': '#7ee787',
    'syntax-attr': '#79c0ff',
    'syntax-literal': '#79c0ff',
    'syntax-meta': neutral[400],
    'syntax-bg': neutral[925]
  }
} as const;

export const lightTheme: ThemeDefinition = {
  dark: false,
  colors: {
    ...syntaxPalette.light,
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
};

export const darkTheme: ThemeDefinition = {
  dark: true,
  colors: {
    ...syntaxPalette.dark,
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
};

/**
 * 终端 ANSI 16 色（xterm 专用，light/dark 各一套）。
 * 语义色（红/绿/黄）与上方 lightTheme/darkTheme 保持一致；
 * 蓝/品红/青等终端才需要的颜色在此补充，组件不得另写死颜色。
 */
export const terminalAnsi = {
  light: [
    neutral[900], // black
    '#cf222e', // red
    '#1a7f37', // green
    '#9a6700', // yellow
    '#0969da', // blue
    '#8250df', // magenta
    '#1b7c83', // cyan
    neutral[600], // white
    neutral[500], // brightBlack
    '#ff7b72', // brightRed
    '#2da44e', // brightGreen
    '#bf8700', // brightYellow
    '#54aeff', // brightBlue
    '#bc8cff', // brightMagenta
    '#39c5cf', // brightCyan
    '#ffffff' // brightWhite
  ],
  dark: [
    neutral[900], // black
    '#f47067', // red
    '#3fb950', // green
    '#d29922', // yellow
    '#58a6ff', // blue
    '#bc8cff', // magenta
    '#39c5cf', // cyan
    neutral[200], // white
    neutral[500], // brightBlack
    '#ffa198', // brightRed
    '#56d364', // brightGreen
    '#e3b341', // brightYellow
    '#79c0ff', // brightBlue
    '#d2a8ff', // brightMagenta
    '#56d4dd', // brightCyan
    '#ffffff' // brightWhite
  ]
} as const;

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
} as const;

export const fontFamilySans =
  "'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

export const fontFamilyMono =
  "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";
