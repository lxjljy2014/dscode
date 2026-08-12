import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import UnoCSS from 'unocss/vite'
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
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
})
