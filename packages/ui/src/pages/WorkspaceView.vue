<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { isFrameless, isMac } from '../bridge/host';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';
import AppHeader from '../components/workspace/AppHeader.vue';
import ChatView from '../components/chat/ChatView.vue';
import UserBar from '../components/common/UserBar.vue';
import WorkspacePanel from '../components/workspace/WorkspacePanel.vue';
import WorkspaceSidebar from '../components/workspace/WorkspaceSidebar.vue';
import TerminalPanel from '../components/workspace/TerminalPanel.vue';

const ui = useUiStore();
const { t } = useI18n();
const sessionStore = useSessionStore();
const { activeSessionId, sessions } = storeToRefs(sessionStore);
const modKey = isMac ? '⌘' : 'Ctrl';
const router = useRouter();

// 会话搜索弹窗（主导航「搜索」项 / ⌘K 打开）
const searchOpen = ref(false);
const searchKeyword = ref('');
const searchInputRef = ref<{ focus: () => void } | null>(null);

const searchResults = computed(() => {
  const k = searchKeyword.value.trim().toLowerCase();
  if (!k) return sessions.value;
  return sessions.value.filter(s => s.title.toLowerCase().includes(k));
});

/** 工作空间 basename（搜索结果副标题） */
function workspaceName(path: string): string {
  if (!path) return t('project.noProject');
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

async function openSearch(): Promise<void> {
  searchKeyword.value = '';
  searchOpen.value = true;
  await nextTick();
  searchInputRef.value?.focus();
}

function selectSearchResult(id: string): void {
  void sessionStore.select(id);
  searchOpen.value = false;
}

function onSearchKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.isComposing && searchResults.value.length > 0) {
    selectSearchResult(searchResults.value[0].id);
  }
}

// 全局快捷键：⌘/Ctrl+N 新建任务、⌘/Ctrl+K 搜索
function onGlobalKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, [contenteditable]')) return;
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === 'n') {
    e.preventDefault();
    sessionStore.createSession();
  } else if (e.key === 'k') {
    e.preventDefault();
    void openSearch();
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown));
</script>

<template>
  <!-- 工作区路由：完整布局（左侧栏 + 顶栏 + 右侧 diff 抽屉 + 主区） -->
  <VNavigationDrawer v-model="ui.leftVisible" :permanent="ui.leftVisible" class="border-r border-line">
    <template #prepend>
      <!-- 顶栏：macOS 让位红绿灯；侧栏切换 + 前进/后退（暂无历史，禁用占位） -->
      <div
        class="h-12 shrink-0 flex items-center gap-0.5 pr-2"
        :class="[isFrameless ? 'ds-drag' : '', isMac ? 'pl-[84px]' : 'pl-2']"
      >
        <VIconBtn
          v-tooltip="{
            text: t('settings.toggleLeft'),
            location: 'bottom'
          }"
          icon="i-lucide:panel-left-close"
          variant="text"
          size="small"
          class="text-muted"
          @click="ui.toggleLeft()"
        />
      </div>

      <!-- 主导航 -->
      <VList class="shrink-0 px-2 pt-2" nav>
        <VListItem prepend-icon="i-lucide:circle-plus" @click="sessionStore.createSession()">
          <VListItemTitle class="text-sm">{{ t('nav.newTask') }}</VListItemTitle>
          <template #append>
            <span class="text-xs text-faint">{{ modKey }} N</span>
          </template>
        </VListItem>
        <VListItem prepend-icon="i-lucide:search" @click="openSearch()">
          <VListItemTitle class="text-sm">{{ t('nav.search') }}</VListItemTitle>
          <template #append>
            <span class="text-xs text-faint">{{ modKey }} K</span>
          </template>
        </VListItem>
        <VListItem prepend-icon="i-lucide:bot">
          <VListItemTitle class="text-sm">{{ t('nav.automation') }}</VListItemTitle>
        </VListItem>
        <VListItem prepend-icon="i-lucide:wand-sparkles" @click="router.push('/settings/skills').catch(() => {})">
          <VListItemTitle class="text-sm">{{ t('nav.skills') }}</VListItemTitle>
        </VListItem>
      </VList>
    </template>
    <WorkspaceSidebar />
    <template #append>
      <UserBar />
    </template>
  </VNavigationDrawer>

  <AppHeader />

  <WorkspacePanel />

  <TerminalPanel />

  <VMain scrollable>
    <ChatView />
  </VMain>

  <!-- 会话搜索弹窗 -->
  <VDialog v-model="searchOpen" max-width="520">
    <VCard>
      <VCardText class="pb-0">
        <VTextField
          ref="searchInputRef"
          v-model="searchKeyword"
          :placeholder="t('session.search')"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          prepend-inner-icon="i-lucide:search"
          @keydown.enter="onSearchKeydown"
        />
      </VCardText>
      <VList nav density="compact" class="max-h-80 overflow-y-auto px-2 pb-2">
        <VListItem
          v-for="s in searchResults"
          :key="s.id"
          :title="s.title || t('session.new')"
          :subtitle="workspaceName(s.workingDirectory)"
          :active="s.id === activeSessionId"
          @click="selectSearchResult(s.id)"
        >
          <template #prepend>
            <VIcon :icon="s.archived ? 'i-lucide:archive' : 'i-lucide:message-square'" size="16" class="text-muted" />
          </template>
        </VListItem>
        <div v-if="!searchResults.length" class="px-4 py-8 text-center text-xs text-faint">
          {{ t('session.notFound') }}
        </div>
      </VList>
    </VCard>
  </VDialog>
</template>
