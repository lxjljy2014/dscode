<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEEPSEEK_PRESET } from '@dscode/shared';
import { useSettingsStore } from '../../stores/settings';

/**
 * 设置页「引导」版块：修改 DeepSeek API key（引导页的后续入口）。
 * 路由守卫保证进入设置页前 settings store 已加载完成。
 */

const { t } = useI18n();
const settingsStore = useSettingsStore();

const showKey = ref(false);
const apiKey = ref(settingsStore.settings.providers.find(p => p.id === 'deepseek')?.apiKey ?? '');

async function save() {
  // 只更新 DeepSeek 预置项：其余供应商（设置页「模型」添加的自定义项）原样保留
  const others = settingsStore.settings.providers.filter(p => p.id !== 'deepseek');
  await settingsStore.save({
    providers: [...others, { ...DEEPSEEK_PRESET, models: [...DEEPSEEK_PRESET.models], apiKey: apiKey.value.trim() }]
  });
}
</script>

<template>
  <div>
    <VCard class="px-4 py-3.5">
      <div class="flex items-center justify-between gap-6">
        <div class="text-sm font-medium">{{ t('onboarding.deepseekApiKey') }}</div>
        <VBtn size="small" color="primary" class="shrink-0" @click="save">
          {{ t('settingsPage.save') }}
        </VBtn>
      </div>
      <VTextField
        v-model="apiKey"
        :type="showKey ? 'text' : 'password'"
        :label="t('onboarding.apiKey')"
        :placeholder="t('onboarding.apiKeyPlaceholder')"
        :append-inner-icon="showKey ? 'i-lucide:eye-off' : 'i-lucide:eye'"
        density="compact" variant="outlined"
        hide-details
        class="mt-2"
        @click:append-inner="showKey = !showKey"
      />
    </VCard>
  </div>
</template>
