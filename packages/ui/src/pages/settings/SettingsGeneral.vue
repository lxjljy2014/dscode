<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { supportedLocales } from '../../plugins/i18n';
import type { LocaleSetting } from '../../stores/ui';
import { useUiStore } from '../../stores/ui';
import { useSettingsStore } from '../../stores/settings';

const { t } = useI18n();
const ui = useUiStore();
const settingsStore = useSettingsStore();

// 界面语言：system + 支持的语言列表
const languageItems = computed(() => [
  { title: t('settingsPage.general.langSystem'), value: 'system' as LocaleSetting },
  ...supportedLocales.map(l => ({ title: l.label, value: l.value as LocaleSetting }))
]);

const language = computed<LocaleSetting>({
  get: () => ui.locale,
  set: value => ui.setLocale(value)
});

const languageLabel = computed(() => languageItems.value.find(item => item.value === ui.locale)?.title ?? '');

// 上下文压力自动压缩（真实设置，主进程持久化）
const autoCompact = computed({
  get: () => settingsStore.settings.autoCompact,
  set: value => void settingsStore.save({ autoCompact: value })
});
const autoCompactThreshold = computed({
  get: () => settingsStore.settings.autoCompactThreshold,
  set: value => void settingsStore.save({ autoCompactThreshold: value })
});

// 以下为占位设置项：仅组件内状态，接入真实配置后改从设置 store 读写
const inheritProfile = ref(true);
const terminalFont = ref('');
const enhancedFindGrep = ref(true);
const httpProxy = ref('');
const proxyExceptions = ref('');
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
    <VCard class="px-4 py-3.5">
      <div class="flex items-center justify-between gap-6">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t('settingsPage.general.language') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">
            {{ t('settingsPage.general.languageDesc') }}
          </div>
        </div>
        <VMenu location="bottom end" :offset="4">
          <template #activator="{ props: menuProps }">
            <VBtn
              v-bind="menuProps"
              variant="outlined"
              size="small"
              class="shrink-0 px-3"
              append-icon="i-lucide:chevron-down"
            >
              {{ languageLabel }}
            </VBtn>
          </template>
          <VList min-width="160" class="p-1">
            <VListItem
              v-for="item in languageItems"
              :key="item.value"
              :active="language === item.value"
              @click="language = item.value"
            >
              <VListItemTitle class="text-sm">{{ item.title }}</VListItemTitle>
              <template #append>
                <VIcon v-if="language === item.value" icon="i-lucide:check" size="16" />
              </template>
            </VListItem>
          </VList>
        </VMenu>
      </div>
    </VCard>

    <!-- 终端 -->
    <VCard class="px-4 py-3.5">
      <div class="flex items-center justify-between gap-6">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t('settingsPage.general.inheritProfile') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">
            {{ t('settingsPage.general.inheritProfileDesc') }}
          </div>
        </div>
        <VSwitch v-model="inheritProfile" inset color="primary" density="compact" hide-details />
      </div>

      <div class="mt-3.5 border-t border-line pt-3.5">
        <div class="flex items-start justify-between gap-6">
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ t('settingsPage.general.terminalFont') }}</div>
            <div class="mt-0.5 text-xs leading-5 text-muted">
              {{ t('settingsPage.general.terminalFontDesc') }}
            </div>
          </div>
          <VBtn size="small" class="shrink-0" disabled>{{ t('settingsPage.general.comingSoon') }}</VBtn>
        </div>
        <VTextField
          v-model="terminalFont"
          density="compact"
          variant="outlined"
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
        <VSwitch v-model="enhancedFindGrep" inset color="primary" density="compact" hide-details />
      </div>
    </VCard>

    <!-- 上下文自动压缩 -->
    <VCard class="px-4 py-3.5">
      <div class="flex items-center justify-between gap-6">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t('settingsPage.general.autoCompact') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">
            {{ t('settingsPage.general.autoCompactDesc') }}
          </div>
        </div>
        <VSwitch v-model="autoCompact" inset color="primary" density="compact" hide-details />
      </div>

      <div v-if="autoCompact" class="mt-3.5 border-t border-line pt-3.5">
        <div class="flex items-center justify-between gap-6">
          <div class="min-w-0">
            <div class="text-sm font-medium">{{ t('settingsPage.general.autoCompactThreshold') }}</div>
            <div class="mt-0.5 text-xs leading-5 text-muted">
              {{ t('settingsPage.general.autoCompactThresholdDesc') }}
            </div>
          </div>
          <span class="shrink-0 font-mono text-sm">{{ autoCompactThreshold }}%</span>
        </div>
        <VSlider
          v-model="autoCompactThreshold"
          :min="50"
          :max="95"
          :step="5"
          color="primary"
          thumb-label
          hide-details
          class="mt-1"
        />
      </div>
    </VCard>

    <!-- 代理 -->
    <VCard class="px-4 py-3.5">
      <div class="flex items-start justify-between gap-6">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t('settingsPage.general.httpProxy') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">
            {{ t('settingsPage.general.httpProxyDesc') }}
          </div>
        </div>
        <VBtn size="small" class="shrink-0" disabled>{{ t('settingsPage.general.comingSoon') }}</VBtn>
      </div>
      <VTextField
        v-model="httpProxy"
        density="compact"
        variant="outlined"
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
        <VBtn size="small" class="shrink-0" disabled>{{ t('settingsPage.general.comingSoon') }}</VBtn>
      </div>
      <VTextField
        v-model="proxyExceptions"
        density="compact"
        variant="outlined"
        :placeholder="t('settingsPage.general.proxyExceptionsPlaceholder')"
        class="mt-2"
      />
    </VCard>
  </div>
</template>
