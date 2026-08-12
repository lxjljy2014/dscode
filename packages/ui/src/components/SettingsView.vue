<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import SettingsHeader from './SettingsHeader.vue'
import SettingsSidebar from './SettingsSidebar.vue'

const { t } = useI18n()
const route = useRoute()

const title = computed(() =>
  t(`settingsPage.section.${(route.params.section as string | undefined) ?? 'general'}`)
)
</script>

<template>
  <!-- 设置路由：完整布局（设置导航侧栏常驻 + 顶栏 + 内容区） -->
  <VNavigationDrawer permanent width="280" class="border-r border-line">
    <SettingsSidebar />
  </VNavigationDrawer>

  <SettingsHeader />

  <VMain>
    <div class="h-full flex flex-col bg-base">
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto max-w-180 px-8 pb-10 pt-6">
          <h1 class="mb-5 select-none text-2xl font-semibold">{{ title }}</h1>
          <RouterView />
        </div>
      </div>
    </div>
  </VMain>
</template>
