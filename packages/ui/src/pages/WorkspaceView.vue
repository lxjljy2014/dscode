<script setup lang="ts">
import AppHeader from '../components/workspace/AppHeader.vue';
import ChatView from '../components/chat/ChatView.vue';
import UserBar from '../components/common/UserBar.vue';
import WorkspacePanel from '../components/workspace/WorkspacePanel.vue';
import WorkspaceSidebar from '../components/workspace/WorkspaceSidebar.vue';
import TerminalPanel from '../components/workspace/TerminalPanel.vue';

import { useUiStore } from '../stores/ui';
import { isFrameless, isMac } from '../bridge/host';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../stores/session';
import { nextTick, ref } from 'vue';
import { storeToRefs } from 'pinia';

const ui = useUiStore();
const { t } = useI18n();
const sessionStore = useSessionStore();
const { keyword } = storeToRefs(sessionStore);
const modKey = isMac ? '⌘' : 'Ctrl';

// 搜索：默认收起，⌘K 或导航项展开
const searchVisible = ref(false);
const searchRef = ref<{ focus: () => void } | null>(null);

async function toggleSearch() {
  searchVisible.value = !searchVisible.value;
  if (searchVisible.value) {
    await nextTick();
    searchRef.value?.focus();
  } else {
    keyword.value = '';
  }
}
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
        <VListItem prepend-icon="i-lucide:search" :active="searchVisible" @click="toggleSearch()">
          <VListItemTitle class="text-sm">{{ t('nav.search') }}</VListItemTitle>
          <template #append>
            <span class="text-xs text-faint">{{ modKey }} K</span>
          </template>
        </VListItem>
        <VListItem prepend-icon="i-lucide:bot">
          <VListItemTitle class="text-sm">{{ t('nav.automation') }}</VListItemTitle>
        </VListItem>
        <VListItem prepend-icon="i-lucide:wand-sparkles">
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
</template>
