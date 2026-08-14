<script setup lang="ts">
import { useUiStore } from '../stores/ui';
import AppHeader from '../components/workspace/AppHeader.vue';
import ChatView from '../components/chat/ChatView.vue';
import UserBar from '../components/common/UserBar.vue';
import WorkspacePanel from '../components/workspace/WorkspacePanel.vue';
import WorkspaceSidebar from '../components/workspace/WorkspaceSidebar.vue';
import TerminalPanel from '../components/workspace/TerminalPanel.vue';

const ui = useUiStore();
</script>

<template>
  <!-- 工作区路由：完整布局（左侧栏 + 顶栏 + 右侧 diff 抽屉 + 主区） -->
  <VNavigationDrawer v-model="ui.leftVisible" :permanent="ui.leftVisible" class="border-r border-line">
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
