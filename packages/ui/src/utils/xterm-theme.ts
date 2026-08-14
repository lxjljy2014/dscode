import type { ITheme } from '@xterm/xterm';
import { darkTheme, lightTheme, neutral, terminalAnsi } from '../theme/tokens';

/**
 * 由 tokens 语义色 + terminalAnsi 生成 xterm 主题（颜色唯一事实源仍是 tokens.ts）。
 * 背景取 surface：与底部抽屉底色一致，让终端区域与面板融合。
 * 滚动条是 xterm 自绘 DOM（.xterm-scrollable-element > .scrollbar > .slider），
 * 颜色由 scrollbarSlider*Background 驱动，自带滚动时显示/空闲淡出。
 */

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function buildXtermTheme(dark: boolean): ITheme {
  // Vuetify 类型允许对象形式颜色；本项目 tokens 全部为 hex 字符串，此处断言收窄
  const colors = (dark ? darkTheme.colors : lightTheme.colors) as Record<string, string>;
  const ansi = dark ? terminalAnsi.dark : terminalAnsi.light;
  return {
    background: colors.background,
    foreground: colors['on-surface'],
    cursor: colors.primary,
    cursorAccent: colors['on-primary'],
    selectionBackground: dark ? neutral[700] : neutral[300],
    selectionForeground: colors['on-surface'],
    scrollbarSliderBackground: withAlpha(colors['on-surface'], 0.18),
    scrollbarSliderHoverBackground: withAlpha(colors['on-surface'], 0.36),
    scrollbarSliderActiveBackground: withAlpha(colors['on-surface'], 0.5),
    // overviewRuler.width 用于收窄滚动条，但会让 xterm 在滚动条旁绘制
    // 概览标尺 outline（默认白色），置为全透明以隐藏
    overviewRulerBorder: 'rgba(0, 0, 0, 0)',
    black: ansi[0],
    red: ansi[1],
    green: ansi[2],
    yellow: ansi[3],
    blue: ansi[4],
    magenta: ansi[5],
    cyan: ansi[6],
    white: ansi[7],
    brightBlack: ansi[8],
    brightRed: ansi[9],
    brightGreen: ansi[10],
    brightYellow: ansi[11],
    brightBlue: ansi[12],
    brightMagenta: ansi[13],
    brightCyan: ansi[14],
    brightWhite: ansi[15]
  };
}
