<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <!-- 暂未实现的版块占位 -->
  <div class="flex flex-col items-center justify-center gap-2 py-24 text-faint select-none">
    <span class="i-lucide:hammer text-8" />
    <div class="text-sm">{{ t('settingsPage.comingSoon') }}</div>
  </div>
</template>
