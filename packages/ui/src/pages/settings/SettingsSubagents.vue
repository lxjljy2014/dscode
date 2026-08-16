<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Subagent } from '@dscode/shared';
import { useSettingsStore } from '../../stores/settings';

const { t } = useI18n();
const settingsStore = useSettingsStore();

const subagents = ref<Subagent[]>([]);
watch(
  () => settingsStore.settings.subagents,
  list => {
    subagents.value = list.map(s => ({ ...s }));
  },
  { immediate: true, deep: true }
);

let seq = 0;
function nextId(): string {
  return 'sub-' + Date.now() + '-' + seq++;
}

const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const draft = ref({ name: '', description: '', systemPrompt: '' });

function openAdd() {
  editingId.value = null;
  draft.value = { name: '', description: '', systemPrompt: '' };
  dialogOpen.value = true;
}

function openEdit(s: Subagent) {
  editingId.value = s.id;
  draft.value = { name: s.name, description: s.description, systemPrompt: s.systemPrompt };
  dialogOpen.value = true;
}

function saveDraft() {
  const name = draft.value.name.trim();
  const systemPrompt = draft.value.systemPrompt.trim();
  if (!name || !systemPrompt) return;
  const patch = { name, description: draft.value.description.trim(), systemPrompt };
  if (editingId.value) {
    const s = subagents.value.find(x => x.id === editingId.value);
    if (s) Object.assign(s, patch);
  } else {
    subagents.value.push({ id: nextId(), ...patch });
  }
  dialogOpen.value = false;
  void persist();
}

function removeSubagent(id: string) {
  subagents.value = subagents.value.filter(s => s.id !== id);
  void persist();
}

async function persist() {
  await settingsStore.save({ subagents: subagents.value.map(s => ({ ...s })) });
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <div class="text-xs text-muted">{{ t('settingsPage.subagents.desc') }}</div>
      <VBtn size="small" color="primary" prepend-icon="i-lucide:plus" @click="openAdd">
        {{ t('settingsPage.subagents.add') }}
      </VBtn>
    </div>

    <VCard
      v-for="s in subagents"
      :key="s.id"
      class="cursor-pointer px-4 py-3 transition-colors hover:bg-elevated"
      @click="openEdit(s)"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium">{{ s.name }}</span>
            <span class="truncate text-sm text-muted">{{ s.description }}</span>
          </div>
          <div class="mt-1.5 truncate text-xs leading-5 text-muted">{{ s.systemPrompt }}</div>
        </div>
        <VBtn
          icon="i-lucide:trash-2"
          variant="text"
          size="small"
          class="shrink-0 text-muted"
          @click.stop="removeSubagent(s.id)"
        />
      </div>
    </VCard>

    <div v-if="!subagents.length" class="flex flex-col items-center justify-center gap-2 py-16 text-faint select-none">
      <span class="i-lucide:briefcase text-8" />
      <div class="text-sm">{{ t('settingsPage.subagents.empty') }}</div>
    </div>

    <VDialog v-model="dialogOpen" max-width="480">
      <VCard>
        <VCardTitle>{{ editingId ? t('settingsPage.subagents.edit') : t('settingsPage.subagents.add') }}</VCardTitle>
        <VCardText>
          <VTextField
            v-model="draft.name"
            :label="t('settingsPage.subagents.name')"
            :placeholder="t('settingsPage.subagents.namePlaceholder')"
            density="compact"
            variant="outlined"
            class="mb-3"
            hide-details
          />
          <VTextField
            v-model="draft.description"
            :label="t('settingsPage.subagents.description')"
            density="compact"
            variant="outlined"
            class="mb-3"
            hide-details
          />
          <VTextarea
            v-model="draft.systemPrompt"
            :label="t('settingsPage.subagents.systemPrompt')"
            density="compact"
            variant="outlined"
            rows="5"
            auto-grow
            hide-details
          />
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" @click="dialogOpen = false">{{ t('dialog.cancel') }}</VBtn>
          <VBtn color="primary" :disabled="!draft.name.trim() || !draft.systemPrompt.trim()" @click="saveDraft">
            {{ t('settingsPage.save') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </div>
</template>
