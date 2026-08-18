<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { GitListResult } from '@dscode/shared';
import { host } from '../../bridge/host';
import { useSettingsStore } from '../../stores/settings';
import GitGraphDialog from './GitGraphDialog.vue';

/**
 * git 分支选择器（chip + 下拉菜单）：ChatInput 与 AppHeader 共用，保证两处一致。
 * 工作目录变化时探测是否 git 仓库；非 git 仓库整体不渲染。分支切换/创建结果自带 snackbar 提示。
 * `tonal` 控制 chip 样式：输入卡片用 text，AppHeader 用 tonal + surface 底色。
 */
withDefaults(defineProps<{ tonal?: boolean }>(), { tonal: false });

const { t } = useI18n();
const settingsStore = useSettingsStore();

const branchMenuOpen = ref(false);
const branchLoading = ref(false);
const branchResult = ref<GitListResult | null>(null);
/** git 状态：unknown 探测中（显示）/ git 是仓库 / no-git 非 git 管理（隐藏分支菜单） */
type GitState = 'unknown' | 'git' | 'no-git';
const gitState = ref<GitState>('unknown');
let probeSeq = 0;

const branchActivator = computed(() => {
  if (branchResult.value?.ok) return branchResult.value.current || t('input.gitBranch');
  return t('input.gitBranch');
});

// 分支搜索过滤
const branchSearch = ref('');
const filteredBranches = computed(() => {
  if (!branchResult.value?.ok) return [];
  const q = branchSearch.value.trim().toLowerCase();
  if (!q) return branchResult.value.branches;
  return branchResult.value.branches.filter(b => b.toLowerCase().includes(q));
});

function onBranchMenu(open: boolean): void {
  if (open) void loadBranches();
  else branchSearch.value = ''; // 关闭时清空搜索
}

// 工作目录变化时探测是否 git 仓库；非 git 管理则隐藏分支菜单
watch(
  () => settingsStore.settings.workingDirectory,
  cwd => {
    if (!host) return;
    const seq = ++probeSeq;
    if (!cwd) {
      gitState.value = 'no-git';
      branchResult.value = null;
      return;
    }
    gitState.value = 'unknown';
    void host.gitListBranches(cwd).then(r => {
      if (seq !== probeSeq) return; // 丢弃过期探测结果
      if (r.ok) {
        gitState.value = 'git';
        branchResult.value = r;
      } else {
        gitState.value = 'no-git';
        branchResult.value = null;
      }
    }).catch(() => {
      // 传输级异常：保持未知态，避免 unhandled rejection
    });
  },
  { immediate: true }
);

async function loadBranches(): Promise<void> {
  const cwd = settingsStore.settings.workingDirectory;
  if (!cwd || !host) return;
  branchLoading.value = true;
  try {
    const r = await host.gitListBranches(cwd);
    // 等待期间工作目录可能已变化：丢弃过期结果，避免覆盖新目录的分支列表
    if (settingsStore.settings.workingDirectory !== cwd) return;
    branchResult.value = r;
  } catch {
    // 传输级异常：保持当前分支列表
  } finally {
    branchLoading.value = false;
  }
}

// ---- 操作结果提示 ----
const snackbarText = ref('');
const snackbarShow = ref(false);

async function switchBranch(branch: string): Promise<void> {
  const cwd = settingsStore.settings.workingDirectory;
  if (!cwd || !host) return;
  try {
    const r = await host.gitCheckout(cwd, branch);
    if (r.ok) {
      await loadBranches();
      snackbarText.value = t('branch.switched', { branch });
    } else {
      snackbarText.value = r.error;
    }
  } catch {
    // 传输级异常：静默返回，可重试
    return;
  }
  snackbarShow.value = true;
}

// 创建并检出新分支：弹窗输入分支名 → git checkout -b
const createBranchDialog = ref(false);
const newBranchName = ref('');

function openCreateBranch(): void {
  createBranchDialog.value = true;
  newBranchName.value = '';
}

async function confirmCreateBranch(): Promise<void> {
  const cwd = settingsStore.settings.workingDirectory;
  const name = newBranchName.value.trim();
  if (!cwd || !name || !host) return;
  createBranchDialog.value = false;
  try {
    const r = await host.gitCreateBranch(cwd, name);
    if (r.ok) {
      await loadBranches();
      snackbarText.value = t('branch.created', { name });
    } else {
      snackbarText.value = r.error;
    }
  } catch {
    // 传输级异常：静默返回，可重试
    return;
  }
  snackbarShow.value = true;
}

// git 图谱弹窗
const graphDialog = ref(false);
</script>

<template>
  <!-- 项目分支：仅 git 仓库显示；列出分支并支持切换 -->
  <VMenu
    v-if="gitState !== 'no-git'"
    v-model="branchMenuOpen"
    :close-on-content-click="false"
    location="top start"
    :offset="4"
    @update:model-value="onBranchMenu"
  >
    <template #activator="{ props: menuProps }">
      <VBtn
        v-bind="menuProps"
        :variant="tonal ? 'tonal' : 'text'"
        :base-color="tonal ? 'surface' : undefined"
        rounded="pill"
        size="small"
        class="text-muted"
        prepend-icon="i-lucide:git-branch"
        append-icon="i-lucide:chevron-down"
      >
        {{ branchActivator }}
      </VBtn>
    </template>
    <VCard min-width="300" rounded="16px">
      <VTextField
        v-model="branchSearch"
        density="compact"
        bg-color="surface"
        variant="solo"
        base-color="surface"
        flat
        hide-details
        :placeholder="t('branch.search')"
      >
        <template #prepend-inner>
          <VIcon icon="i-lucide:search" size="small" />
        </template>
      </VTextField>
      <VDivider />
      <VProgressLinear v-if="branchLoading" indeterminate color="primary" />
      <template v-else>
        <VList v-if="branchResult?.ok" nav density="compact" prepend-gap="12">
          <VListItem
            v-for="b in filteredBranches"
            :key="b"
            :title="b"
            prepend-icon="i-lucide:git-branch"
            :append-icon="b === branchResult.current ? 'i-lucide:check' : undefined"
            rounded="pill"
            @click="switchBranch(b)"
          />
          <VListItem v-if="filteredBranches.length === 0" :title="t('branch.empty')" rounded="pill" disabled />
        </VList>
        <VList v-else nav density="compact" prepend-gap="12">
          <VListItem
            :title="branchResult?.ok === false ? branchResult.error : t('branch.loading')"
            rounded="pill"
            disabled
          />
        </VList>
      </template>
      <VDivider />
      <!-- 固定选项：创建分支 / git 图谱（置于底部） -->
      <VList nav density="compact" prepend-gap="12">
        <VListItem
          :title="t('branch.create')"
          prepend-icon="i-lucide:git-branch-plus"
          rounded="pill"
          @click="openCreateBranch"
        />
        <VListItem
          :title="t('branch.graph')"
          prepend-icon="i-lucide:git-graph"
          rounded="pill"
          @click="graphDialog = true"
        />
      </VList>
    </VCard>
  </VMenu>

  <!-- 创建并检出新分支 -->
  <VDialog v-model="createBranchDialog" max-width="360">
    <VCard class="rounded-16px">
      <VCardTitle>{{ t('branch.create') }}</VCardTitle>
      <VCardText>
        <VTextField
          v-model="newBranchName"
          :label="t('branch.nameLabel')"
          density="compact"
          hide-details
          autofocus
          @keydown.enter="confirmCreateBranch"
        />
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :text="t('dialog.cancel')" @click="createBranchDialog = false" />
        <VBtn
          color="primary"
          :text="t('dialog.create')"
          :disabled="!newBranchName.trim()"
          @click="confirmCreateBranch"
        />
      </VCardActions>
    </VCard>
  </VDialog>

  <!-- git 图谱 -->
  <GitGraphDialog v-model="graphDialog" />

  <!-- 分支操作结果提示（切换/创建/错误） -->
  <VSnackbar v-model="snackbarShow" :timeout="2500">
    {{ snackbarText }}
  </VSnackbar>
</template>
