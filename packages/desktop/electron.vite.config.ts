import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'electron-vite';
import UnoCSS from 'unocss/vite';
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify';

export default defineConfig({
  main: {
    build: {
      // electron-vite 5：externalizeDepsPlugin 已弃用，改用 build.externalizeDeps 配置。
      // exclude 掉 workspace 包（core/shared）打进产物：若外部化，Node 运行时直接加载其
      // TS 源码，目录 re-export 会报 ERR_UNSUPPORTED_DIR_IMPORT，交给 rollup 打包规避。
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
