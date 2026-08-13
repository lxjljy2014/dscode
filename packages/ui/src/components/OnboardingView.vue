<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { DEEPSEEK_PRESET } from '@dscode/shared';
import { useSettingsStore } from '../stores/settings';
import { isFrameless, isMac } from '../host';

/**
 * 首次启动引导页：输入 DeepSeek API key（baseURL 与模型用预置默认值）。
 * 开始使用/稍后再说都会置 onboardingDone，避免每次启动重复弹出；
 * 之后可在设置页「引导」版块修改。
 */

const { t } = useI18n();
const router = useRouter();
const settingsStore = useSettingsStore();

const showKey = ref(false);
// 预填已保存的 key（重访引导页时不丢失）
const apiKey = ref('');

onMounted(async () => {
  await settingsStore.load();
  apiKey.value = settingsStore.settings.providers.find(p => p.id === 'deepseek')?.apiKey ?? '';
});

const canStart = computed(() => apiKey.value.trim().length > 0);

async function finish() {
  await settingsStore.save({
    providers: [{ ...DEEPSEEK_PRESET, models: [...DEEPSEEK_PRESET.models], apiKey: apiKey.value.trim() }],
    onboardingDone: true
  });
  await router.replace('/');
}

async function skip() {
  await settingsStore.save({ onboardingDone: true });
  await router.replace('/');
}
</script>

<template>
  <div class="flex h-screen flex-col bg-base">
    <!-- 标题栏拖拽区：macOS 让位红绿灯 -->
    <div class="h-12 shrink-0" :class="[isFrameless ? 'ds-drag' : '', isMac ? 'pl-[84px]' : 'pl-2']" />

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex min-h-full max-w-120 flex-col justify-center px-8 py-10">
        <!-- Logo + 标题 -->
        <div class="mb-8 flex flex-col items-center gap-4 text-center select-none">
          <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-elevated text-primary">
            <span class="i-lucide:sparkles text-5" />
          </div>
          <div>
            <h1 class="text-2xl font-semibold">{{ t('onboarding.title') }}</h1>
            <p class="mt-2 text-sm text-muted">{{ t('onboarding.subtitle') }}</p>
          </div>
        </div>

        <VTextField
          v-model="apiKey"
          variant="outlined"
          rounded="lg"
          :type="showKey ? 'text' : 'password'"
          :label="t('onboarding.apiKey')"
          :placeholder="t('onboarding.apiKeyPlaceholder')"
          :append-inner-icon="showKey ? 'i-lucide:eye-off' : 'i-lucide:eye'"
          density="compact"
          hide-details
          @click:append-inner="showKey = !showKey"
        />

        <div class="mt-6 flex items-center justify-center gap-3">
          <VBtn color="primary" :disabled="!canStart" @click="finish">{{ t('onboarding.start') }}</VBtn>
          <VBtn variant="text" @click="skip">{{ t('onboarding.skip') }}</VBtn>
        </div>
      </div>
    </div>
  </div>
</template>
