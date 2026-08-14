<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ThemeMode } from '../../stores/ui';
import { useUiStore } from '../../stores/ui';

const { t } = useI18n();
const ui = useUiStore();

const theme = computed<ThemeMode>({
  get: () => ui.theme,
  set: value => {
    ui.theme = value;
  }
});

const options: { value: ThemeMode; icon: string; label: string }[] = [
  { value: 'light', icon: 'i-lucide:sun', label: t('settingsPage.appearance.light') },
  { value: 'dark', icon: 'i-lucide:moon', label: t('settingsPage.appearance.dark') }
];
</script>

<template>
  <div class="flex flex-col gap-4">
    <VCard class="px-4 py-3.5">
      <div class="flex items-center justify-between gap-6">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t('settingsPage.appearance.theme') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">{{ t('settingsPage.appearance.themeDesc') }}</div>
        </div>
        <VBtnToggle v-model="theme" mandatory density="comfortable" class="shrink-0">
          <VBtn
            v-for="o in options"
            :key="o.value"
            :value="o.value"
            :prepend-icon="o.icon"
            size="small"
            class="px-3"
          >
            {{ o.label }}
          </VBtn>
        </VBtnToggle>
      </div>
    </VCard>
  </div>
</template>
