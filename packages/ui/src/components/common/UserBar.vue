<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <!-- 底部用户栏：两个路由的左侧栏共用 -->
  <div class="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
    <VAvatar size="26" color="primary">
      <span class="text-xs font-medium text-on-primary">D</span>
    </VAvatar>
    <span class="truncate text-sm">developer</span>
    <VSpacer />
    <VBtn icon="i-lucide:app-window" variant="text" size="x-small" class="text-muted" />
    <VBtn
      icon="i-lucide:settings"
      variant="text"
      size="x-small"
      class="text-muted"
      @click="router.push('/settings').catch(() => {})"
    />
  </div>
</template>
