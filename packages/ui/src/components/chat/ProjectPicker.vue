<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { host } from '../../bridge/host';
import { useSessionStore } from '../../stores/session';
import { useSettingsStore } from '../../stores/settings';

/** 项目选择菜单（最近工作空间 + 打开文件夹 + 远程 + 不在项目中工作）；自 ChatInput 拆出 */

const { t } = useI18n();
const sessionStore = useSessionStore();
const settingsStore = useSettingsStore();

const projectMenuOpen = ref(false);
const snackbarText = ref('');
const snackbarShow = ref(false);
/** 项目搜索关键词（按名称 + 路径不区分大小写过滤） */
const projectKeyword = ref('');
const { recentWorkspaces, homeDir } = storeToRefs(sessionStore);
const filteredProjects = computed(() => {
  const k = projectKeyword.value.trim().toLowerCase();
  if (!k) return recentWorkspaces.value;
  return recentWorkspaces.value.filter(p => `${p.name} ${p.path}`.toLowerCase().includes(k));
});

function dirName(p: string): string {
  return (
    p
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || p
  );
}

/** 当前项目名：工作目录 basename（未选择时显示"选择项目"） */
const currentProject = computed(() => {
  const wd = settingsStore.settings.workingDirectory;
  return wd ? dirName(wd) : '';
});

function onProjectMenu(open: boolean): void {
  if (open) void sessionStore.refreshWorkspaces();
}

async function selectProject(path: string): Promise<void> {
  projectMenuOpen.value = false;
  await settingsStore.save({ workingDirectory: path });
}

async function openFolder(): Promise<void> {
  projectMenuOpen.value = false;
  if (!host) return;
  const dir = await host.pickDirectory();
  if (dir) await selectProject(dir);
}

/** 不在项目中工作：工作目录归零到默认（家目录） */
async function resetProject(): Promise<void> {
  if (!homeDir.value) await sessionStore.refreshWorkspaces();
  if (!homeDir.value) return;
  await selectProject(homeDir.value);
}

/** 远程连接：暂未实现 */
function remoteConnect(): void {
  projectMenuOpen.value = false;
  snackbarText.value = t('project.remoteNotReady');
  snackbarShow.value = true;
}
</script>

<template>
  <VMenu
    v-model="projectMenuOpen"
    :close-on-content-click="false"
    location="top start"
    :offset="4"
    @update:model-value="onProjectMenu"
  >
    <template #activator="{ props: menuProps }">
      <VBtn
        v-bind="menuProps"
        variant="text"
        rounded="pill"
        size="small"
        class="text-muted"
        prepend-icon="i-lucide:folder"
        append-icon="i-lucide:chevron-down"
      >
        {{ currentProject || t('input.selectProject') }}
      </VBtn>
    </template>
    <VCard min-width="300" rounded="16px">
      <VTextField
        v-model="projectKeyword"
        density="compact"
        hide-details
        bg-color="surface"
        base-color="surface"
        variant="solo"
        flat
        :placeholder="t('project.search')"
      >
        <template #prepend-inner>
          <VIcon icon="i-lucide:search" size="small" />
        </template>
      </VTextField>
      <VDivider></VDivider>
      <VList v-if="recentWorkspaces.length > 0" nav density="compact" prepend-gap="12" class="max-h-64 overflow-y-auto">
        <VListItem
          v-for="p in filteredProjects"
          :key="p.path"
          :title="p.name"
          :subtitle="p.path"
          prepend-icon="i-lucide:folder"
          rounded="pill"
          @click="selectProject(p.path)"
        />
        <VListItem v-if="!filteredProjects.length" :title="t('project.noMatch')" rounded="pill" disabled />
      </VList>
      <VList v-else nav density="compact" prepend-gap="12">
        <VListItem :title="t('project.empty')" rounded="pill" disabled />
      </VList>
      <VDivider />
      <VList nav density="compact" prepend-gap="12">
        <VListItem
          :title="t('project.openFolder')"
          prepend-icon="i-lucide:folder-plus"
          rounded="pill"
          @click="openFolder"
        />
        <VListItem :title="t('project.remote')" rounded="pill" prepend-icon="i-lucide:cloud" @click="remoteConnect" />
        <VListItem
          :title="t('project.noProject')"
          rounded="pill"
          prepend-icon="i-lucide:message-circle"
          @click="resetProject"
        />
      </VList>
    </VCard>
  </VMenu>

  <VSnackbar v-model="snackbarShow" :timeout="2500">
    {{ snackbarText }}
  </VSnackbar>
</template>
