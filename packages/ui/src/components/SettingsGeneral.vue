<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { supportedLocales } from '../plugins/i18n'
import type { LocaleSetting } from '../stores/ui'
import { useUiStore } from '../stores/ui'

const { t } = useI18n()
const ui = useUiStore()

// 界面语言：system + 支持的语言列表
const languageItems = computed(() => [
  { title: t('settingsPage.general.langSystem'), value: 'system' as LocaleSetting },
  ...supportedLocales.map(l => ({ title: l.label, value: l.value as LocaleSetting }))
])

const language = computed<LocaleSetting>({
  get: () => ui.locale,
  set: value => ui.setLocale(value)
})

const languageLabel = computed(
  () => languageItems.value.find(item => item.value === ui.locale)?.title ?? ''
)

// 以下为占位设置项：仅组件内状态，接入真实配置后改从设置 store 读写
const inheritProfile = ref(true)
const terminalFont = ref('')
const enhancedFindGrep = ref(true)
const httpProxy = ref('')
const proxyExceptions = ref('')
</script>

<template>
  <!-- 分组标签 -->
  <div class="mb-3">
    <span class="rounded-md bg-elevated px-2 py-1 text-xs text-muted">
      {{ t('settingsPage.general.default') }}
    </span>
  </div>

  <div class="flex flex-col gap-4">
    <!-- 界面语言 -->
    <v-card class="px-4 py-3.5">
      <div class="flex items-center justify-between gap-6">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t('settingsPage.general.language') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">
            {{ t('settingsPage.general.languageDesc') }}
          </div>
        </div>
        <v-menu location="bottom end" :offset="4">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              variant="outlined"
              size="small"
              class="shrink-0 px-3"
              append-icon="i-lucide:chevron-down"
            >
              {{ languageLabel }}
            </v-btn>
          </template>
          <v-list min-width="160" class="p-1">
            <v-list-item
              v-for="item in languageItems"
              :key="item.value"
              :active="language === item.value"
              @click="language = item.value"
            >
              <v-list-item-title class="text-sm">{{ item.title }}</v-list-item-title>
              <template #append>
                <v-icon v-if="language === item.value" icon="i-lucide:check" size="16" />
              </template>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </v-card>

    <!-- 终端 -->
    <v-card class="px-4 py-3.5">
      <div class="flex items-center justify-between gap-6">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t('settingsPage.general.inheritProfile') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">
            {{ t('settingsPage.general.inheritProfileDesc') }}
          </div>
        </div>
        <v-switch v-model="inheritProfile" inset color="primary" density="compact" hide-details />
      </div>

      <div class="mt-3.5 border-t border-line pt-3.5">
        <div class="flex items-start justify-between gap-6">
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ t('settingsPage.general.terminalFont') }}</div>
            <div class="mt-0.5 text-xs leading-5 text-muted">
              {{ t('settingsPage.general.terminalFontDesc') }}
            </div>
          </div>
          <v-btn size="small" class="shrink-0">{{ t('settingsPage.save') }}</v-btn>
        </div>
        <v-text-field
          v-model="terminalFont"
          density="compact"
          :placeholder="t('settingsPage.general.terminalFontPlaceholder')"
          class="mt-2"
        />
      </div>

      <div class="mt-3.5 flex items-center justify-between gap-6 border-t border-line pt-3.5">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t('settingsPage.general.findGrep') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">
            {{ t('settingsPage.general.findGrepDesc') }}
          </div>
        </div>
        <v-switch v-model="enhancedFindGrep" inset color="primary" density="compact" hide-details />
      </div>
    </v-card>

    <!-- 代理 -->
    <v-card class="px-4 py-3.5">
      <div class="flex items-start justify-between gap-6">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t('settingsPage.general.httpProxy') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">
            {{ t('settingsPage.general.httpProxyDesc') }}
          </div>
        </div>
        <v-btn size="small" class="shrink-0">{{ t('settingsPage.save') }}</v-btn>
      </div>
      <v-text-field
        v-model="httpProxy"
        density="compact"
        :placeholder="t('settingsPage.general.httpProxyPlaceholder')"
        class="mt-2"
      />

      <div class="mt-3.5 flex items-start justify-between gap-6 border-t border-line pt-3.5">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t('settingsPage.general.proxyExceptions') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">
            {{ t('settingsPage.general.proxyExceptionsDesc') }}
          </div>
        </div>
        <v-btn size="small" class="shrink-0">{{ t('settingsPage.save') }}</v-btn>
      </div>
      <v-text-field
        v-model="proxyExceptions"
        density="compact"
        :placeholder="t('settingsPage.general.proxyExceptionsPlaceholder')"
        class="mt-2"
      />
    </v-card>
  </div>
</template>
