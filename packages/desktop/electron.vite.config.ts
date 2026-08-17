import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';
import UnoCSS from 'unocss/vite';
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify';

export default defineConfig({
  main: {
    build: {
      // electron-vite 5：externalizeDepsPlugin 已弃用，改用 build.externalizeDeps 配置。
      // externalizeDeps 只会外部化 dependencies（node-pty/electron-updater）；@dscode/core 与
      // @dscode/shared 是 devDependencies，本就被 rollup 打进 main 产物。exclude 为防御性保留
      // （避免未来把 core/shared 提升为 dependencies 时被外部化，触发 ERR_UNSUPPORTED_DIR_IMPORT）。
      externalizeDeps: { exclude: ['@dscode/core', '@dscode/shared'] }
    }
  },
  preload: {
    build: {
      externalizeDeps: true
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
      }
    },
    plugins: [
      vue({ template: { transformAssetUrls } }),
      vuetify({
        autoImport: true,
        styles: { configFile: 'src/styles/settings.scss' }
      }),
      UnoCSS({ configFile: fileURLToPath(new URL('./uno.config.ts', import.meta.url)) })
    ]
  }
});
