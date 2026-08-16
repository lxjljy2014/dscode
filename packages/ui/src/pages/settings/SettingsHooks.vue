<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Hook, HookTrigger } from '@dscode/shared';
import { useSettingsStore } from '../../stores/settings';

const { t } = useI18n();
const settingsStore = useSettingsStore();

const hooks = ref<Hook[]>([]);
watch(
  () => settingsStore.settings.hooks,
  list => {
    hooks.value = list.map(h => ({ ...h }));
  },
  { immediate: true, deep: true }
);

let seq = 0;
function nextId(): string {
  return 'hook-' + Date.now() + '-' + seq++;
}

const triggerItems = computed(() =>
  (['session_start', 'session_end', 'tool_done'] as HookTrigger[]).map(v => ({
    value: v,
    title: t('settingsPage.hooks.trigger.' + v)
  }))
);

const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const draft = ref({ name: '', trigger: 'tool_done' as HookTrigger, command: '' });

function openAdd() {
  editingId.value = null;
  draft.value = { name: '', trigger: 'tool_done', command: '' };
  dialogOpen.value = true;
}

function openEdit(h: Hook) {
  editingId.value = h.id;
  draft.value = { name: h.name, trigger: h.trigger, command: h.command };
  dialogOpen.value = true;
}

function saveDraft() {
  const name = draft.value.name.trim();
  const command = draft.value.command.trim();
  if (!name || !command) return;
  const patch = { name, trigger: draft.value.trigger, command };
  if (editingId.value) {
    const h = hooks.value.find(x => x.id === editingId.value);
    if (h) Object.assign(h, patch);
  } else {
    hooks.value.push({ id: nextId(), ...patch });
  }
  dialogOpen.value = false;
  void persist();
}

function removeHook(id: string) {
  hooks.value = hooks.value.filter(h => h.id !== id);
  void persist();
}

async function persist() {
  await settingsStore.save({ hooks: hooks.value.map(h => ({ ...h })) });
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <div class="text-xs text-muted">{{ t('settingsPage.hooks.desc') }}</div>
      <VBtn size="small" color="primary" prepend-icon="i-lucide:plus" @click="openAdd">
        {{ t('settingsPage.hooks.add') }}
      </VBtn>
    </div>

    <VCard
      v-for="h in hooks"
      :key="h.id"
      class="cursor-pointer px-4 py-3 transition-colors hover:bg-elevated"
      @click="openEdit(h)"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium">{{ h.name }}</span>
            <span class="rounded bg-elevated px-1.5 py-0.5 text-xs text-muted">
              {{ t('settingsPage.hooks.trigger.' + h.trigger) }}
            </span>
          </div>
          <div class="mt-1.5 truncate font-mono text-xs leading-5 text-muted">{{ h.command }}</div>
        </div>
        <VBtn
          icon="i-lucide:trash-2"
          variant="text"
          size="small"
          class="shrink-0 text-muted"
          @click.stop="removeHook(h.id)"
        />
      </div>
    </VCard>

    <div v-if="!hooks.length" class="flex flex-col items-center justify-center gap-2 py-16 text-faint select-none">
      <span class="i-lucide:anchor text-8" />
      <div class="text-sm">{{ t('settingsPage.hooks.empty') }}</div>
    </div>

    <VDialog v-model="dialogOpen" max-width="480">
      <VCard>
        <VCardTitle>{{ editingId ? t('settingsPage.hooks.edit') : t('settingsPage.hooks.add') }}</VCardTitle>
        <VCardText>
          <VTextField
            v-model="draft.name"
            :label="t('settingsPage.hooks.name')"
            density="compact"
            variant="outlined"
            class="mb-3"
            hide-details
          />
          <VSelect
            v-model="draft.trigger"
            :label="t('settingsPage.hooks.triggerLabel')"
            :items="triggerItems"
            item-title="title"
            item-value="value"
            density="compact"
            variant="outlined"
            class="mb-3"
            hide-details
          />
          <VTextField
            v-model="draft.command"
            :label="t('settingsPage.hooks.command')"
            :placeholder="t('settingsPage.hooks.commandPlaceholder')"
            density="compact"
            variant="outlined"
            hide-details
          />
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" @click="dialogOpen = false">{{ t('dialog.cancel') }}</VBtn>
          <VBtn color="primary" :disabled="!draft.name.trim() || !draft.command.trim()" @click="saveDraft">
            {{ t('settingsPage.save') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </div>
</template>
