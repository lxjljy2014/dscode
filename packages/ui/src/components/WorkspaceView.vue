<script setup lang="ts">
import { useUiStore } from '../stores/ui'
import AppHeader from './AppHeader.vue'
import ChatView from './ChatView.vue'
import UserBar from './UserBar.vue'
import WorkspacePanel from './WorkspacePanel.vue'
import WorkspaceSidebar from './WorkspaceSidebar.vue'
import TerminalPanel from "./TerminalPanel.vue";

const ui = useUiStore()
</script>

<template>
  <!-- 工作区路由：完整布局（左侧栏 + 顶栏 + 右侧 diff 抽屉 + 主区） -->
  <v-navigation-drawer
    v-model="ui.leftVisible"
    :permanent="ui.leftVisible"
    width="280"
    class="border-r border-line"
  >
    <WorkspaceSidebar />
    <template #append>
      <UserBar />
    </template>
  </v-navigation-drawer>

  <AppHeader />

  <WorkspacePanel />

  <TerminalPanel />

  <v-main scrollable>
    <ChatView />
  </v-main>

</template>
