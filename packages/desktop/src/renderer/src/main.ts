import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18nPlugin, createVuetifyPlugin } from '@dscode/ui'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
// vuetify/styles 在 @dscode/ui 的插件模块中引入，先于 uno.css
import 'virtual:uno.css'
import '@dscode/ui/global.css'
import App from './App.vue'
import { router } from './router'

const app = createApp(App)

app.use(createPinia())
app.use(createVuetifyPlugin())
app.use(createI18nPlugin())
app.use(router)

app.mount('#app')
