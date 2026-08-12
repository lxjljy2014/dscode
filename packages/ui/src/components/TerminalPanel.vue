<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useUiStore } from '../stores/ui'

const { t } = useI18n()
const uiStore = useUiStore()
</script>

<template>
  <v-navigation-drawer
    v-model="uiStore.terminalVisible"
    :permanent="uiStore.terminalVisible"
    location="bottom"
    width="280"
  >
    {{ t('terminal.placeholder') }}
  </v-navigation-drawer>
</template>
