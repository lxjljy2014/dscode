<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MemoryEntry } from '@dscode/shared';
import { useSettingsStore } from '../../stores/settings';

const { t } = useI18n();
const settingsStore = useSettingsStore();

const entries = ref<MemoryEntry[]>([]);
watch(
  () => settingsStore.settings.memory,
  list => {
    entries.value = list.map(e => ({ ...e }));
  },
  { immediate: true, deep: true }
);

const draft = ref('');
let seq = 0;
function nextId(): string {
  return `mem-${Date.now()}-${seq++}`;
}

function addEntry() {
  const content = draft.value.trim();
  if (!content) return;
  entries.value.push({ id: nextId(), content });
  draft.value = '';
  void persist();
}

function removeEntry(id: string) {
  entries.value = entries.value.filter(e => e.id !== id);
  void persist();
}

async function persist() {
  await settingsStore.save({ memory: entries.value.map(e => ({ ...e })) });
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <VCard class="px-4 py-3.5">
      <div class="text-sm font-medium">{{ t('settingsPage.memory.title') }}</div>
      <div class="mt-0.5 text-xs leading-5 text-muted">{{ t('settingsPage.memory.desc') }}</div>
      <div class="mt-3 flex items-center gap-2">
        <VTextField
          v-model="draft"
          density="compact"
          hide-details
          :placeholder="t('settingsPage.memory.placeholder')"
          class="flex-1"
          @keydown.enter="addEntry"
        />
        <VBtn size="small" color="primary" class="shrink-0" @click="addEntry">
          {{ t('settingsPage.memory.add') }}
        </VBtn>
      </div>
    </VCard>

    <VCard v-for="e in entries" :key="e.id" class="px-4 py-3">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{{ e.content }}</div>
        <VBtn
          icon="i-lucide:trash-2"
          variant="text"
          size="small"
          class="shrink-0 text-muted"
          @click="removeEntry(e.id)"
        />
      </div>
    </VCard>

    <div v-if="!entries.length" class="flex flex-col items-center justify-center gap-2 py-16 text-faint select-none">
      <span class="i-lucide:brain text-8" />
      <div class="text-sm">{{ t('settingsPage.memory.empty') }}</div>
    </div>
  </div>
</template>
