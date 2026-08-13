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

/** 工作空间显示名：basename；未选择时显示占位 */
function groupName(path: string): string {
  if (!path) return t('project.noProject');
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

// 默认展开当前工作空间组；切换工作空间时跟随展开
const currentGroup = computed(() => groupValue(settingsStore.settings.workingDirectory));
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
    <div class="flex shrink-0 items-center justify-between px-3 py-1">
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

    <!-- 工作空间分组：每个工作空间一个项目组，任务按归属挂在组下 -->
    <div v-if="projectOpen" class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      <VList v-model:opened="opened" class="-mx-1 p-0" nav>
        <VListGroup v-for="g in workspaceGroups" :key="groupValue(g.path)" :value="groupValue(g.path)">
          <template #activator="{ props: activatorProps }">
            <VListItem v-bind="activatorProps" prepend-icon="i-lucide:folder" class="mb-0.5 bg-elevated">
              <VListItemTitle class="truncate text-sm">{{ groupName(g.path) }}</VListItemTitle>
            </VListItem>
          </template>

          <VListItem
            v-for="s in g.sessions"
            :key="s.id"
            :active="s.id === activeSessionId"
            class="mb-0.5"
            @click="store.select(s.id)"
          >
            <VListItemTitle class="truncate text-sm">
              {{ s.title || t('session.new') }}
            </VListItemTitle>
          </VListItem>

          <div v-if="!g.sessions.length" class="py-2 pl-9 text-sm text-faint">
            {{ keyword ? t('session.notFound') : t('session.empty') }}
          </div>
        </VListGroup>
      </VList>
    </div>
    <div v-else class="flex-1" />
  </div>
</template>
