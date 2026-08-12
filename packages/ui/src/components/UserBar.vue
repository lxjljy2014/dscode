<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <!-- 底部用户栏：两个路由的左侧栏共用 -->
  <div class="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
    <v-avatar size="26" color="primary">
      <span class="text-xs font-medium text-on-primary">D</span>
    </v-avatar>
    <span class="truncate text-sm">developer</span>
    <v-spacer />
    <v-btn icon="i-lucide:app-window" variant="text" size="x-small" class="text-muted" />
    <v-btn
      icon="i-lucide:settings"
      variant="text"
      size="x-small"
      class="text-muted"
      @click="router.push('/settings').catch(() => {})"
    />
  </div>
</template>
