<script setup lang="ts">
import { onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePluginsStore } from '../../stores/plugins';

const { t } = useI18n();
const pluginsStore = usePluginsStore();

onMounted(() => {
  void pluginsStore.load();
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="text-xs text-muted">{{ t('settingsPage.plugins.desc') }}</div>

    <VCard v-for="p in pluginsStore.plugins" :key="p.id" class="px-4 py-3.5">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ p.name }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">{{ p.description }}</div>
          <div v-if="p.commands?.length" class="mt-1.5 flex flex-wrap gap-1.5">
            <VChip v-for="c in p.commands" :key="c.id" size="small" class="font-mono">/{{ c.name }}</VChip>
          </div>
        </div>
      </div>
    </VCard>

    <div
      v-if="!pluginsStore.plugins.length"
      class="flex flex-col items-center justify-center gap-2 py-16 text-faint select-none"
    >
      <span class="i-lucide:puzzle text-8" />
      <div class="text-sm">{{ t('settingsPage.plugins.empty') }}</div>
    </div>
  </div>
</template>
