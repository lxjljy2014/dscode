<script setup lang="ts">
import { useUiStore } from '../stores/ui'
import DiffPanel from './DiffPanel.vue'

const uiStore = useUiStore()
</script>

<template>
  <v-navigation-drawer
    v-model="uiStore.terminalVisible"
    :permanent="uiStore.terminalVisible"
    location="bottom"
    width="280"
  >
<!--    <DiffPanel />-->

    你好
  </v-navigation-drawer>
</template>
