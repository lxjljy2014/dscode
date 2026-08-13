<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../stores/session';
import { useSettingsStore } from '../stores/settings';

const { t } = useI18n();
const store = useSessionStore();
const { activeSessionId, keyword, workspaceGroups } = storeToRefs(store);
const settingsStore = useSettingsStore();

// 项目区折叠状态
const projectOpen = ref(true);

/** 组 value 用前缀区分（'ws:' + 工作目录路径） */
const groupValue = (path: string) => `ws:${path}`;

/** 当前工作空间（组名高亮用） */
const currentWorkspace = computed(() => settingsStore.settings.workingDirectory);

/** 组显示名：优先最近项目的 name，回退 basename，无路径时显示占位 */
function displayName(g: { path: string; name: string }): string {
  if (g.name) return g.name;
  if (!g.path) return t('project.noProject');
  return g.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || g.path;
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

    <!-- 工作空间分组：VList 默认样式，组头 + 子任务列表 -->
    <div v-if="projectOpen" class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <VList v-model:opened="opened" nav>
        <VListGroup v-for="g in workspaceGroups" :key="groupValue(g.path)" :value="groupValue(g.path)">
          <template #activator="{ props: activatorProps }">
            <VListItem v-bind="activatorProps" :title="displayName(g)" prepend-icon="i-lucide:folder" />
          </template>

          <VListItem
            v-for="s in g.sessions"
            :key="s.id"
            :active="s.id === activeSessionId"
            :title="s.title || t('session.new')"
            @click="store.select(s.id)"
          />

          <div v-if="!g.sessions.length" class="py-1 pl-10 text-xs text-faint">
            {{ keyword ? t('session.notFound') : t('session.empty') }}
          </div>
        </VListGroup>
      </VList>
    </div>
    <div v-else class="flex-1" />
  </div>
</template>
