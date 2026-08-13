import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createI18nPlugin, createVuetifyPlugin } from '@dscode/ui';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
// vuetify/styles 在 @dscode/ui 的插件模块中引入，先于 uno.css
import 'virtual:uno.css';
import '@dscode/ui/global.css';
import App from './App.vue';
import { router } from './router';

const app = createApp(App);

app.use(createPinia());
app.use(createVuetifyPlugin());
app.use(createI18nPlugin());
app.use(router);

// 占位页最短展示时长（ms）：加载快时也保留固定时长，避免启动页一闪而过。
// 实际展示时长 = max(此值, 首屏加载耗时)；boot.ts 的兜底超时需大于两者之和
const SPLASH_MIN_MS = 3000;

async function mount(): Promise<void> {
  // performance.now() 自页面导航起计时，即占位页已展示的时长
  const elapsed = performance.now();
  if (elapsed < SPLASH_MIN_MS) {
    await new Promise(resolve => setTimeout(resolve, SPLASH_MIN_MS - elapsed));
  }
  app.mount('#app');
}

void mount();
