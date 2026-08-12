import { createI18n } from 'vue-i18n';
import zhCN from '@dscode/shared/locales/zh-CN.json';
import enUS from '@dscode/shared/locales/en-US.json';

export type AppLocale = 'zh-CN' | 'en-US';

export const supportedLocales: { value: AppLocale; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' }
];

/** vue-i18n locale → Vuetify locale 的映射 */
export const vuetifyLocaleMap: Record<AppLocale, string> = {
  'zh-CN': 'zhHans',
  'en-US': 'en'
};

export function createI18nPlugin(initialLocale: AppLocale = 'zh-CN') {
  return createI18n({
    legacy: false,
    locale: initialLocale,
    fallbackLocale: 'en-US',
    messages: {
      'zh-CN': zhCN,
      'en-US': enUS
    }
  });
}
