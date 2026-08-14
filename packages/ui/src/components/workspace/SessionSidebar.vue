<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../../stores/session';
import { useSettingsStore } from '../../stores/settings';

const { t } = useI18n();
const store = useSessionStore();
const { activeSessionId, keyword, workspaceGroups, archivedSessions, recentWorkspaces, removedWorkspaces } =
  storeToRefs(store);
const settingsStore = useSettingsStore();

// 项目区折叠状态
const projectOpen = ref(true);

/** 组 value 用前缀区分（'ws:' + 工作目录路径） */
const groupValue = (path: string) => `ws:${path}`;

/** 当前工作空间（组名高亮/禁用移除用） */
const currentWorkspace = computed(() => settingsStore.settings.workingDirectory);

/** 组显示名：优先最近项目的 name，回退 basename，无路径时显示占位 */
function displayName(g: { path: string; name: string }): string {
  if (g.name) return g.name;
  if (!g.path) return t('project.noProject');
  return (
    g.path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || g.path
  );
}

/** 归档任务的所属项目名（副标题用，兼容最近/已移除项目表） */
function workspaceDisplay(path: string): string {
  if (!path) return t('project.noProject');
  const rp = [...recentWorkspaces.value, ...removedWorkspaces.value].find(p => p.path === path);
  if (rp?.name) return rp.name;
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  );
}

// 默认展开当前工作空间组；切换工作空间时跟随展开
const currentGroup = computed(() => groupValue(currentWorkspace.value));
const opened = ref<string[]>([]);
watch(
  currentGroup,
  v => {
    if (v && !opened.value.includes(v)) opened.value = [...opened.value, v];
  },
  { immediate: true }
);

// 移除项目：直接移除（任务保留，重新打开项目后恢复）+ 反馈
async function removeWorkspace(g: { path: string }): Promise<void> {
  await store.removeWorkspace(g.path);
  showSnackbar(t('sidebar.removed'));
}

// 归档两步确认：先点归档按钮变为确认按钮，再点确认才真正归档
const confirmArchiveId = ref<string | null>(null);
function startArchive(s: { id: string }): void {
  confirmArchiveId.value = s.id;
}
function resetArchiveConfirm(): void {
  confirmArchiveId.value = null;
}

// 归档/恢复任务反馈
const snackbar = ref(false);
const snackbarText = ref('');
function showSnackbar(text: string): void {
  snackbarText.value = text;
  snackbar.value = true;
}
async function archiveTask(s: { id: string }): Promise<void> {
  resetArchiveConfirm();
  await store.setArchived(s.id, true);
  showSnackbar(t('sidebar.archivedDone'));
}
async function restoreTask(s: { id: string }): Promise<void> {
  await store.setArchived(s.id, false);
  showSnackbar(t('sidebar.restored'));
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 项目栏：折叠开关 + 更多/新建 -->
    <div class="flex shrink-0 items-center justify-between px-2 py-1">
      <VBtn
        variant="text"
        size="small"
        class="-ml-1 px-2 text-faint"
        :append-icon="projectOpen ? 'i-lucide:chevron-down' : 'i-lucide:chevron-right'"
        @click="projectOpen = !projectOpen"
      >
        {{ t('sidebar.project') }}
      </VBtn>
      <div class="flex items-center">
        <VTooltip :text="t('sidebar.more')" location="bottom">
          <template #activator="{ props }">
            <VBtn v-bind="props" icon="i-lucide:ellipsis" variant="text" size="x-small" class="text-muted" />
          </template>
        </VTooltip>
        <VTooltip :text="t('nav.newTask')" location="bottom">
          <template #activator="{ props }">
            <VBtn
              v-bind="props"
              icon="i-lucide:plus"
              variant="text"
              size="x-small"
              class="text-muted"
              @click="store.createSession()"
            />
          </template>
        </VTooltip>
      </div>
    </div>

    <!-- 工作空间分组 + 已归档区 -->
    <div v-if="projectOpen" class="min-h-0 flex-1 overflow-y-auto pb-3">
      <VList v-model:opened="opened" nav>
        <VListGroup v-for="g in workspaceGroups" :key="groupValue(g.path)" :value="groupValue(g.path)">
          <template #activator="{ props: activatorProps }">
            <VListItem v-bind="activatorProps" :title="displayName(g)" prepend-icon="i-lucide:folder" class="group/ws">
              <template #append>
                <div class="flex items-center" @click.stop>
                  <VMenu location="bottom end">
                    <template #activator="{ props: menuProps }">
                      <VBtn
                        v-bind="menuProps"
                        icon="i-lucide:more-horizontal"
                        variant="text"
                        size="x-small"
                        class="text-muted opacity-0 transition-opacity group-hover/ws:opacity-100"
                      />
                    </template>
                    <VList density="compact" nav class="min-w-40">
                      <VListItem
                        :title="t('sidebar.removeProject')"
                        prepend-icon="i-lucide:folder-minus"
                        @click="removeWorkspace(g)"
                      />
                    </VList>
                  </VMenu>
                </div>
              </template>
            </VListItem>
          </template>

          <!-- 任务行：悬停显示归档按钮；两步确认（归档 → 确认） -->
          <VListItem
            v-for="s in g.sessions"
            :key="s.id"
            :active="s.id === activeSessionId"
            :title="s.title || t('session.new')"
            class="group/task"
            @click="store.select(s.id)"
            @mouseleave="resetArchiveConfirm"
          >
            <template #append>
              <div class="opacity-0 transition-opacity group-hover/task:opacity-100" @click.stop>
                <VTooltip v-if="confirmArchiveId !== s.id" :text="t('sidebar.archiveTask')" location="bottom">
                  <template #activator="{ props }">
                    <VIconBtn
                      v-bind="props"
                      icon="i-lucide:archive"
                      variant="text"
                      size="small"
                      rounded="lg"
                      class="text-muted"
                      @click="startArchive(s)"
                    />
                  </template>
                </VTooltip>
                <VBtn v-else variant="tonal" size="small" color="error" text="确认" @click="archiveTask(s)" />
              </div>
            </template>
          </VListItem>

          <div v-if="!g.sessions.length" class="py-1 pl-10 text-xs text-faint">
            {{ keyword ? t('session.notFound') : t('session.empty') }}
          </div>
        </VListGroup>

        <!-- 已归档区：默认折叠，带数量；归档任务可恢复 -->
        <VListGroup v-if="archivedSessions.length" value="archived">
          <template #activator="{ props: activatorProps }">
            <VListItem
              v-bind="activatorProps"
              prepend-icon="i-lucide:archive"
              :title="t('sidebar.archived')"
              class="group/arc"
            >
              <template #append>
                <div class="flex items-center" @click.stop>
                  <span class="text-xs tabular-nums text-faint">{{ archivedSessions.length }}</span>
                </div>
              </template>
            </VListItem>
          </template>

          <VListItem
            v-for="s in archivedSessions"
            :key="s.id"
            :active="s.id === activeSessionId"
            :title="s.title || t('session.new')"
            :subtitle="workspaceDisplay(s.workingDirectory)"
            class="group/task"
            @click="store.select(s.id)"
          >
            <template #append>
              <div class="opacity-0 transition-opacity group-hover/task:opacity-100" @click.stop>
                <VTooltip :text="t('sidebar.unarchiveTask')" location="bottom">
                  <template #activator="{ props }">
                    <VBtn
                      v-bind="props"
                      icon="i-lucide:archive-restore"
                      variant="text"
                      size="x-small"
                      class="text-muted"
                      @click="restoreTask(s)"
                    />
                  </template>
                </VTooltip>
              </div>
            </template>
          </VListItem>

          <div v-if="!archivedSessions.length" class="py-1 pl-10 text-xs text-faint">
            {{ t('sidebar.emptyArchived') }}
          </div>
        </VListGroup>
      </VList>
    </div>
    <div v-else class="flex-1" />

    <!-- 操作反馈 -->
    <VSnackbar v-model="snackbar" :timeout="2000">
      {{ snackbarText }}
    </VSnackbar>
  </div>
</template>
