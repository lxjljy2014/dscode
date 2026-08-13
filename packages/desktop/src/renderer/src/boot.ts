/**
 * 启动引导（先于 main.ts 加载）：
 * 1. 占位页主题：读应用持久化主题（localStorage dscode.ui，与 ui store 同 key），
 *    在 html 上打 ds-theme-dark / ds-theme-light 类供 index.html 占位页配色；
 *    未设置时回退系统偏好。须早于 main.ts，避免占位页闪错深浅色。
 * 2. 开发模式挂载兜底：dev 冷启动时 vite-plugin-vuetify 的虚拟样式模块偶发 404，
 *    应用会一直停留在占位页；超时未挂载则自动刷新一次（服务器已暖、可正常挂载）。
 */

function applySplashTheme(): void {
  let theme: string | undefined;
  try {
    const raw = JSON.parse(localStorage.getItem('dscode.ui') ?? '{}') as { theme?: string };
    theme = raw.theme;
  } catch {
    // 持久化数据损坏时忽略，走系统偏好
  }
  let dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (theme === 'dark') dark = true;
  else if (theme === 'light') dark = false;
  document.documentElement.classList.add(dark ? 'ds-theme-dark' : 'ds-theme-light');
}
applySplashTheme();

if (import.meta.env.DEV) {
  const RETRY_KEY = 'dscode.boot-retried';
  // 占位页替换为 VApp 即视为挂载成功；阈值要大于「正常冷启动耗时 + 占位页最短展示」
  // （main.ts 的 SPLASH_MIN_MS 会把挂载延后），避免误判正常慢加载为失败
  const TIMEOUT_MS = 10000;

  if (!sessionStorage.getItem(RETRY_KEY)) {
    setTimeout(() => {
      if (!document.querySelector('#app > .v-application')) {
        sessionStorage.setItem(RETRY_KEY, RETRY_KEY);
        location.reload();
      }
    }, TIMEOUT_MS);
  }
}

export {};
