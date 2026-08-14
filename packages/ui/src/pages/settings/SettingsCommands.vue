<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Command } from '@dscode/shared';
import { useSettingsStore } from '../../stores/settings';

const { t } = useI18n();
const settingsStore = useSettingsStore();

const commands = ref<Command[]>([]);
watch(
  () => settingsStore.settings.commands,
  list => {
    commands.value = list.map(c => ({ ...c }));
  },
  { immediate: true, deep: true }
);

let seq = 0;
function nextId(): string {
  return `cmd-${Date.now()}-${seq++}`;
}

// 新增/编辑共用对话框
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const draft = ref({ name: '', description: '', prompt: '' });

function openAdd() {
  editingId.value = null;
  draft.value = { name: '', description: '', prompt: '' };
  dialogOpen.value = true;
}

function openEdit(c: Command) {
  editingId.value = c.id;
  draft.value = { name: c.name, description: c.description, prompt: c.prompt };
  dialogOpen.value = true;
}

function saveDraft() {
  const name = draft.value.name.trim().replace(/^\//, '');
  const description = draft.value.description.trim();
  const prompt = draft.value.prompt.trim();
  if (!name || !prompt) return;
  if (editingId.value) {
    const c = commands.value.find(x => x.id === editingId.value);
    if (c) Object.assign(c, { name, description, prompt });
  } else {
    commands.value.push({ id: nextId(), name, description, prompt });
  }
  dialogOpen.value = false;
  void persist();
}

function removeCommand(id: string) {
  commands.value = commands.value.filter(c => c.id !== id);
  void persist();
}

async function persist() {
  await settingsStore.save({ commands: commands.value.map(c => ({ ...c })) });
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <div class="text-xs text-muted">{{ t('settingsPage.commands.desc') }}</div>
      <VBtn size="small" color="primary" prepend-icon="i-lucide:plus" @click="openAdd">
        {{ t('settingsPage.commands.add') }}
      </VBtn>
    </div>

    <VCard v-for="c in commands" :key="c.id" class="px-4 py-3">
      <div class="flex items-start justify-between gap-4">
        <button class="min-w-0 flex-1 cursor-pointer text-left" @click="openEdit(c)">
          <div class="flex items-center gap-2">
            <code class="rounded bg-elevated px-1.5 py-0.5 text-xs font-mono">/{{ c.name }}</code>
            <span class="truncate text-sm">{{ c.description }}</span>
          </div>
          <div class="mt-1.5 truncate text-xs leading-5 text-muted">{{ c.prompt }}</div>
        </button>
        <VBtn
          icon="i-lucide:trash-2"
          variant="text"
          size="small"
          class="shrink-0 text-muted"
          @click="removeCommand(c.id)"
        />
      </div>
    </VCard>

    <div v-if="!commands.length" class="flex flex-col items-center justify-center gap-2 py-16 text-faint select-none">
      <span class="i-lucide:square-terminal text-8" />
      <div class="text-sm">{{ t('settingsPage.commands.empty') }}</div>
    </div>

    <VDialog v-model="dialogOpen" max-width="480">
      <VCard>
        <VCardTitle>{{ editingId ? t('settingsPage.commands.edit') : t('settingsPage.commands.add') }}</VCardTitle>
        <VCardText>
          <VTextField
            v-model="draft.name"
            :label="t('settingsPage.commands.name')"
            :placeholder="t('settingsPage.commands.namePlaceholder')"
            density="compact" variant="outlined"
            class="mb-3"
            hide-details
          />
          <VTextField
            v-model="draft.description"
            :label="t('settingsPage.commands.description')"
            density="compact" variant="outlined"
            class="mb-3"
            hide-details
          />
          <VTextarea
            v-model="draft.prompt"
            :label="t('settingsPage.commands.prompt')"
            :placeholder="t('settingsPage.commands.promptPlaceholder')"
            density="compact" variant="outlined"
            rows="4"
            auto-grow
            hide-details
          />
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" @click="dialogOpen = false">{{ t('dialog.cancel') }}</VBtn>
          <VBtn color="primary" :disabled="!draft.name.trim() || !draft.prompt.trim()" @click="saveDraft">
            {{ t('settingsPage.save') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </div>
</template>
