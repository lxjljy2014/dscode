<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Skill } from '@dscode/shared';
import { useSettingsStore } from '../../stores/settings';

const { t } = useI18n();
const settingsStore = useSettingsStore();

const skills = ref<Skill[]>([]);
watch(
  () => settingsStore.settings.skills,
  list => {
    skills.value = list.map(s => ({ ...s }));
  },
  { immediate: true, deep: true }
);

let seq = 0;
function nextId(): string {
  return 'skill-' + Date.now() + '-' + seq++;
}

const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const draft = ref({ name: '', description: '', instructions: '' });

function openAdd() {
  editingId.value = null;
  draft.value = { name: '', description: '', instructions: '' };
  dialogOpen.value = true;
}

function openEdit(s: Skill) {
  editingId.value = s.id;
  draft.value = { name: s.name, description: s.description, instructions: s.instructions };
  dialogOpen.value = true;
}

function saveDraft() {
  const name = draft.value.name.trim();
  const instructions = draft.value.instructions.trim();
  if (!name || !instructions) return;
  const patch = { name, description: draft.value.description.trim(), instructions };
  if (editingId.value) {
    const s = skills.value.find(x => x.id === editingId.value);
    if (s) Object.assign(s, patch);
  } else {
    skills.value.push({ id: nextId(), ...patch });
  }
  dialogOpen.value = false;
  void persist();
}

function removeSkill(id: string) {
  skills.value = skills.value.filter(s => s.id !== id);
  void persist();
}

async function persist() {
  await settingsStore.save({ skills: skills.value.map(s => ({ ...s })) });
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <div class="text-xs text-muted">{{ t('settingsPage.skills.desc') }}</div>
      <VBtn size="small" color="primary" prepend-icon="i-lucide:plus" @click="openAdd">
        {{ t('settingsPage.skills.add') }}
      </VBtn>
    </div>

    <VCard v-for="s in skills" :key="s.id" class="px-4 py-3">
      <div class="flex items-start justify-between gap-4">
        <button class="min-w-0 flex-1 cursor-pointer text-left" @click="openEdit(s)">
          <div class="flex items-center gap-2">
            <code class="rounded bg-elevated px-1.5 py-0.5 text-xs font-mono">{{ s.name }}</code>
            <span class="truncate text-sm">{{ s.description }}</span>
          </div>
          <div class="mt-1.5 truncate text-xs leading-5 text-muted">{{ s.instructions }}</div>
        </button>
        <VBtn icon="i-lucide:trash-2" variant="text" size="small" class="shrink-0 text-muted" @click="removeSkill(s.id)" />
      </div>
    </VCard>

    <div v-if="!skills.length" class="flex flex-col items-center justify-center gap-2 py-16 text-faint select-none">
      <span class="i-lucide:wand-sparkles text-8" />
      <div class="text-sm">{{ t('settingsPage.skills.empty') }}</div>
    </div>

    <VDialog v-model="dialogOpen" max-width="480">
      <VCard>
        <VCardTitle>{{ editingId ? t('settingsPage.skills.edit') : t('settingsPage.skills.add') }}</VCardTitle>
        <VCardText>
          <VTextField
            v-model="draft.name"
            :label="t('settingsPage.skills.name')"
            :placeholder="t('settingsPage.skills.namePlaceholder')"
            density="compact"
            class="mb-3"
            hide-details
          />
          <VTextField
            v-model="draft.description"
            :label="t('settingsPage.skills.description')"
            density="compact"
            class="mb-3"
            hide-details
          />
          <VTextarea
            v-model="draft.instructions"
            :label="t('settingsPage.skills.instructions')"
            density="compact"
            rows="5"
            auto-grow
            hide-details
          />
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" @click="dialogOpen = false">{{ t('dialog.cancel') }}</VBtn>
          <VBtn color="primary" :disabled="!draft.name.trim() || !draft.instructions.trim()" @click="saveDraft">
            {{ t('settingsPage.save') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </div>
</template>
