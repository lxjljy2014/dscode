<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { isFrameless, isMac } from '../host';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const activeSection = computed(() => (route.params.section as string | undefined) ?? 'general');

// 设置导航分组：icon 与 section key 一一对应，文案走 settingsPage.section.*
const groups = computed(() => [
  {
    label: t('settingsPage.group.basic'),
    items: [
      { key: 'general', icon: 'i-lucide:sliders-horizontal' },
      { key: 'appearance', icon: 'i-lucide:palette' },
      { key: 'model', icon: 'i-lucide:server' },
      { key: 'browser', icon: 'i-lucide:globe' }
    ]
  },
  {
    label: t('settingsPage.group.agent'),
    items: [
      { key: 'memory', icon: 'i-lucide:brain' },
      { key: 'plugins', icon: 'i-lucide:puzzle' },
      { key: 'skills', icon: 'i-lucide:wand-sparkles' },
      { key: 'subagents', icon: 'i-lucide:briefcase' },
      { key: 'mcp', icon: 'i-lucide:list-tree' },
      { key: 'commands', icon: 'i-lucide:square-terminal' },
      { key: 'hooks', icon: 'i-lucide:anchor' }
    ]
  },
  {
    label: t('settingsPage.group.data'),
    items: [
      { key: 'index', icon: 'i-lucide:shield-check' },
      { key: 'usage', icon: 'i-lucide:chart-column' },
      { key: 'onboarding', icon: 'i-lucide:rocket' }
    ]
  }
]);
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶部拖拽条：macOS 让位红绿灯 -->
    <div class="h-12 shrink-0" :class="[isFrameless ? 'ds-drag' : '', isMac ? 'pl-[84px]' : 'pl-2']" />

    <!-- 返回工作区 -->
    <div class="shrink-0 px-2 pb-2">
      <VBtn
        variant="text"
        size="small"
        class="-ml-1 px-2 text-muted"
        prepend-icon="i-lucide:arrow-left"
        @click="router.push('/')"
      >
        {{ t('settingsPage.back') }}
      </VBtn>
    </div>

    <!-- 设置导航 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <template v-for="group in groups" :key="group.label">
        <div class="mb-1 mt-3 px-3 text-xs font-medium text-faint first:mt-1">
          {{ group.label }}
        </div>
        <VList class="p-0" nav>
          <VListItem
            v-for="item in group.items"
            :key="item.key"
            :prepend-icon="item.icon"
            :active="activeSection === item.key"
            class="mb-0.5"
            @click="router.push(`/settings/${item.key}`)"
          >
            <VListItemTitle class="text-sm">
              {{ t(`settingsPage.section.${item.key}`) }}
            </VListItemTitle>
          </VListItem>
        </VList>
      </template>
    </div>
  </div>
</template>
