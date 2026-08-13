<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { ProviderConfig } from '@dscode/shared';
import { DEEPSEEK_PRESET } from '@dscode/shared';
import { normalizeProviders, useSettingsStore } from '../stores/settings';
import { isFrameless, isMac } from '../host';
import ProviderEditor from './ProviderEditor.vue';

/**
 * 首次启动引导页：引导用户填写 AI 供应商 API key。
 * 开始使用/稍后再说都会置 onboardingDone，避免每次启动重复弹出；
 * 之后可在设置页「引导」版块修改。
 */

const { t } = useI18n();
const router = useRouter();
const settingsStore = useSettingsStore();

const providers = ref<ProviderConfig[]>([]);

onMounted(async () => {
  await settingsStore.load();
  // providers 为空（首次）时预填 DeepSeek 预置项，apiKey 留空待填写
  providers.value =
    settingsStore.settings.providers.length > 0
      ? settingsStore.settings.providers
      : [{ ...DEEPSEEK_PRESET, models: [...DEEPSEEK_PRESET.models] }];
});

const hasApiKey = computed(() => providers.value.some(p => p.apiKey.trim().length > 0));

async function finish() {
  await settingsStore.save({ providers: normalizeProviders(providers.value), onboardingDone: true });
  await router.replace('/');
}

async function skip() {
  // 跳过只置引导完成，不保存半填写的 providers
  await settingsStore.save({ onboardingDone: true });
  await router.replace('/');
}
</script>

<template>
  <div class="flex h-screen flex-col bg-base">
    <!-- 标题栏拖拽区：macOS 让位红绿灯 -->
    <div class="h-12 shrink-0" :class="[isFrameless ? 'ds-drag' : '', isMac ? 'pl-[84px]' : 'pl-2']" />

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex max-w-180 flex-col px-8 pb-10 pt-6">
        <!-- Logo + 标题 -->
        <div class="mb-6 flex flex-col items-center gap-3 text-center select-none">
          <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-elevated text-primary">
            <span class="i-lucide:sparkles text-5" />
          </div>
          <h1 class="text-2xl font-semibold">{{ t('onboarding.title') }}</h1>
          <p class="max-w-120 text-sm leading-6 text-muted">{{ t('onboarding.subtitle') }}</p>
        </div>

        <ProviderEditor v-model="providers" />

        <!-- 安全说明 -->
        <p class="mt-4 flex items-center gap-1.5 text-xs text-faint">
          <span class="i-lucide:lock text-sm" />
          {{ t('onboarding.securityNote') }}
        </p>

        <!-- 操作按钮 -->
        <div class="mt-6 flex items-center justify-center gap-3">
          <VBtn color="primary" :disabled="!hasApiKey" @click="finish">
            {{ t('onboarding.start') }}
          </VBtn>
          <VBtn variant="text" @click="skip">{{ t('onboarding.skip') }}</VBtn>
        </div>
      </div>
    </div>
  </div>
</template>
