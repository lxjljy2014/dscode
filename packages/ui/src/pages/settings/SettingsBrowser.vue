<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { host } from '../../bridge/host';
import { useSettingsStore } from '../../stores/settings';

const { t } = useI18n();
const settingsStore = useSettingsStore();

const browsingEnabled = computed<boolean>({
  get: () => settingsStore.settings.browsingEnabled,
  set: value => {
    void settingsStore.save({ browsingEnabled: value });
  }
});

const testUrl = ref('');
const result = ref('');
const error = ref('');
const loading = ref(false);

async function testFetch() {
  if (!host || !testUrl.value.trim()) return;
  loading.value = true;
  error.value = '';
  result.value = '';
  try {
    const r = await host.browserFetch(testUrl.value.trim());
    if (r.ok) result.value = r.content;
    else error.value = r.error;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <VCard class="px-4 py-3.5">
      <div class="flex items-center justify-between gap-6">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t('settingsPage.browser.enable') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">{{ t('settingsPage.browser.enableDesc') }}</div>
        </div>
        <VSwitch v-model="browsingEnabled" inset color="primary" density="compact" hide-details />
      </div>
    </VCard>

    <VCard class="px-4 py-3.5">
      <div class="text-sm font-medium">{{ t('settingsPage.browser.test') }}</div>
      <div class="mt-2 flex items-center gap-2">
        <VTextField
          v-model="testUrl"
          density="compact" variant="outlined"
          hide-details
          :placeholder="t('settingsPage.browser.placeholder')"
          class="flex-1"
          @keydown.enter="testFetch"
        />
        <VBtn size="small" variant="outlined" :loading="loading" @click="testFetch">
          {{ t('settingsPage.browser.fetch') }}
        </VBtn>
      </div>
      <div v-if="error" class="mt-2 text-xs text-red-400">{{ error }}</div>
      <div
        v-else-if="result"
        class="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded bg-elevated p-2 text-xs leading-5"
      >
        {{ result }}
      </div>
    </VCard>
  </div>
</template>
