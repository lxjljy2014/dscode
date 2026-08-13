<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { DEEPSEEK_PRESET } from '@dscode/shared';
import { useSettingsStore } from '../stores/settings';
import { host, isFrameless, isMac } from '../host';

/**
 * 首次启动引导页：输入 DeepSeek API key，验证通过后进入工作区。
 * 校验请求由主进程发起（渲染端 CSP 不允许直连外部 API）；
 * 完成后置 onboardingDone，避免每次启动重复弹出。
 */

const DEEPSEEK_KEYS_URL = 'https://platform.deepseek.com/api_keys';

// 应用图标：renderer/public/icon.png（与 resources/icon.png 同图）。
// 用绑定表达式而非静态 src，避免 vue transformAssetUrls 把它当组件相对路径的静态资源解析。
const logoUrl = './icon.png';

const { t } = useI18n();
const router = useRouter();
const settingsStore = useSettingsStore();

const showKey = ref(false);
const verifying = ref(false);
// 校验失败原因：'invalid' = key 无效，'network' = 网络/服务异常
const verifyError = ref<'' | 'invalid' | 'network'>('');
// 预填已保存的 key（重访引导页时不丢失）
const apiKey = ref('');

onMounted(async () => {
  await settingsStore.load();
  apiKey.value = settingsStore.settings.providers.find(p => p.id === 'deepseek')?.apiKey ?? '';
});

const canSubmit = computed(() => !verifying.value && apiKey.value.trim().length > 0);

const errorMessages = computed(() =>
  verifyError.value
    ? [verifyError.value === 'invalid' ? t('onboarding.verifyInvalid') : t('onboarding.verifyFailed')]
    : []
);

// 编辑 key 时清除上一次的校验错误
watch(apiKey, () => {
  verifyError.value = '';
});

async function finish() {
  const key = apiKey.value.trim();
  if (!canSubmit.value) return;
  verifying.value = true;
  verifyError.value = '';
  try {
    if (host) {
      const result = await host.verifyProvider(DEEPSEEK_PRESET.baseUrl, key);
      if (!result.ok) {
        verifyError.value = result.reason === 'unauthorized' ? 'invalid' : 'network';
        return;
      }
    }
    // 纯浏览器环境无法校验，直接保存进入
    await settingsStore.save({
      providers: [{ ...DEEPSEEK_PRESET, models: [...DEEPSEEK_PRESET.models], apiKey: key }],
      onboardingDone: true
    });
    await router.replace('/');
  } finally {
    verifying.value = false;
  }
}

async function skip() {
  // 稍后配置：只置引导完成，不保存半填写的 key
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
          <img :src="logoUrl" alt="DSCode" class="h-14 w-14 rounded-lg" />
          <div>
            <h1 class="text-2xl font-semibold">{{ t('onboarding.title') }}</h1>
            <p class="mt-2 text-sm text-muted">{{ t('onboarding.subtitle') }}</p>
          </div>
        </div>

        <!-- 普通 div 包裹：避免 .v-input 的 flex:1 在居中 flex 列中被拉伸 -->
        <div>
          <VTextField
            v-model="apiKey"
            variant="outlined"
            rounded="lg"
            :type="showKey ? 'text' : 'password'"
            :placeholder="t('onboarding.apiKeyPlaceholder')"
            :append-inner-icon="showKey ? 'i-lucide:eye-off' : 'i-lucide:eye'"
            :error-messages="errorMessages"
            density="compact"
            @keydown.enter="finish"
            @click:append-inner="showKey = !showKey"
          />
        </div>

        <VBtn
          color="primary"
          size="large"
          class="mt-6 w-full"
          prepend-icon="i-lucide:lock-open"
          :loading="verifying"
          :disabled="!canSubmit"
          @click="finish"
        >
          {{ t('onboarding.start') }}
        </VBtn>

        <!-- 稍后配置 -->
        <VBtn variant="text" class="mt-2 self-center text-muted" :disabled="verifying" @click="skip">
          {{ t('onboarding.later') }}
        </VBtn>

        <!-- 页脚：帮助链接 + 本地存储说明 -->
        <div class="mt-6 flex flex-col items-center gap-1.5">
          <a
            :href="DEEPSEEK_KEYS_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-1 text-xs text-muted hover:underline"
          >
            <span class="i-lucide:book-open text-sm" />
            {{ t('onboarding.howTo') }}
          </a>
          <p class="flex items-center gap-1 text-xs text-faint">
            <span class="i-lucide:lock text-sm" />
            {{ t('onboarding.localOnly') }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
