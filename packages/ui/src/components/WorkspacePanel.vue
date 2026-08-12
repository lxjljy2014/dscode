<script setup lang="ts">
import { useUiStore } from '../stores/ui'
import DiffPanel from './DiffPanel.vue'

const ui = useUiStore()
</script>

<template>
  <VNavigationDrawer
    v-model="ui.rightVisible"
    :permanent="ui.rightVisible"
    location="right"
    width="440"
    class="border-l border-line"
  >
    <DiffPanel />
  </VNavigationDrawer>
</template>
