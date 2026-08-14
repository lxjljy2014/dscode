<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { McpServer, McpToolInfo } from '@dscode/shared';
import { host } from '../../bridge/host';
import { useSettingsStore } from '../../stores/settings';

const { t } = useI18n();
const settingsStore = useSettingsStore();

const servers = ref<McpServer[]>([]);
watch(
  () => settingsStore.settings.mcpServers,
  list => {
    servers.value = list.map(s => ({ ...s, args: [...s.args] }));
  },
  { immediate: true, deep: true }
);

let seq = 0;
function nextId(): string {
  return 'mcp-' + Date.now() + '-' + seq++;
}

const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const draft = ref({ name: '', command: '', argsText: '' });

const toolsByServer = ref<Record<string, McpToolInfo[]>>({});
const loadingId = ref<string | null>(null);
const errorByServer = ref<Record<string, string>>({});

function openAdd() {
  editingId.value = null;
  draft.value = { name: '', command: '', argsText: '' };
  dialogOpen.value = true;
}

function openEdit(s: McpServer) {
  editingId.value = s.id;
  draft.value = { name: s.name, command: s.command, argsText: s.args.join(' ') };
  dialogOpen.value = true;
}

function parseArgs(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function saveDraft() {
  const name = draft.value.name.trim();
  const command = draft.value.command.trim();
  if (!name || !command) return;
  const patch = { name, command, args: parseArgs(draft.value.argsText) };
  if (editingId.value) {
    const s = servers.value.find(x => x.id === editingId.value);
    if (s) Object.assign(s, patch);
  } else {
    servers.value.push({ id: nextId(), ...patch });
  }
  dialogOpen.value = false;
  void persist();
}

function removeServer(id: string) {
  servers.value = servers.value.filter(s => s.id !== id);
  void persist();
}

async function persist() {
  await settingsStore.save({ mcpServers: servers.value.map(s => ({ ...s, args: [...s.args] })) });
}

async function listTools(s: McpServer) {
  if (!host) return;
  loadingId.value = s.id;
  errorByServer.value[s.id] = '';
  try {
    const r = await host.listMcpTools(s.command, s.args);
    if (r.ok) toolsByServer.value[s.id] = r.tools;
    else errorByServer.value[s.id] = r.error;
  } finally {
    loadingId.value = null;
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <div class="text-xs text-muted">{{ t('settingsPage.mcp.desc') }}</div>
      <VBtn size="small" color="primary" prepend-icon="i-lucide:plus" @click="openAdd">
        {{ t('settingsPage.mcp.add') }}
      </VBtn>
    </div>

    <VCard v-for="s in servers" :key="s.id" class="px-4 py-3.5">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium">{{ s.name }}</span>
            <code class="truncate font-mono text-xs text-muted">{{ s.command }} {{ s.args.join(' ') }}</code>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <VChip v-for="tool in toolsByServer[s.id] ?? []" :key="tool.name" size="small">{{ tool.name }}</VChip>
            <span v-if="errorByServer[s.id]" class="text-xs text-red-400">{{ errorByServer[s.id] }}</span>
            <span v-else-if="!toolsByServer[s.id]" class="text-xs text-faint">
              {{ loadingId === s.id ? t('settingsPage.mcp.loading') : t('settingsPage.mcp.noTools') }}
            </span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <VBtn size="small" variant="outlined" :loading="loadingId === s.id" @click="listTools(s)">
            {{ t('settingsPage.mcp.listTools') }}
          </VBtn>
          <VBtn icon="i-lucide:pencil" variant="text" size="small" class="text-muted" @click="openEdit(s)" />
          <VBtn icon="i-lucide:trash-2" variant="text" size="small" class="text-muted" @click="removeServer(s.id)" />
        </div>
      </div>
    </VCard>

    <div v-if="!servers.length" class="flex flex-col items-center justify-center gap-2 py-16 text-faint select-none">
      <span class="i-lucide:list-tree text-8" />
      <div class="text-sm">{{ t('settingsPage.mcp.empty') }}</div>
    </div>

    <VDialog v-model="dialogOpen" max-width="480">
      <VCard>
        <VCardTitle>{{ editingId ? t('settingsPage.mcp.edit') : t('settingsPage.mcp.add') }}</VCardTitle>
        <VCardText>
          <VTextField
            v-model="draft.name"
            :label="t('settingsPage.mcp.name')"
            density="compact" variant="outlined"
            class="mb-3"
            hide-details
          />
          <VTextField
            v-model="draft.command"
            :label="t('settingsPage.mcp.command')"
            :placeholder="t('settingsPage.mcp.commandPlaceholder')"
            density="compact" variant="outlined"
            class="mb-3"
            hide-details
          />
          <VTextField
            v-model="draft.argsText"
            :label="t('settingsPage.mcp.args')"
            :placeholder="t('settingsPage.mcp.argsPlaceholder')"
            density="compact" variant="outlined"
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
