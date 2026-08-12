<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '../stores/session'

const { t } = useI18n()
const store = useSessionStore()
const { filteredSessions, activeSessionId, keyword } = storeToRefs(store)

// 当前项目（占位，接入真实工作区后从项目状态读取）
const projectName = 'dscode'
// 项目区折叠状态
const projectOpen = ref(true)
// v-list-group 展开的分组（默认展开当前项目）
const opened = ref(['project'])
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 项目栏：折叠开关 + 更多/新建 -->
    <div class="flex shrink-0 items-center justify-between px-3 py-1">
      <v-btn
        variant="text"
        size="small"
        class="-ml-1 px-2 text-faint"
        :append-icon="projectOpen ? 'i-lucide:chevron-down' : 'i-lucide:chevron-right'"
        @click="projectOpen = !projectOpen"
      >
        {{ t('sidebar.project') }}
      </v-btn>
      <div class="flex items-center">
        <v-tooltip :text="t('sidebar.more')" location="bottom">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="i-lucide:ellipsis" variant="text" size="x-small" class="text-muted" />
          </template>
        </v-tooltip>
        <v-tooltip :text="t('nav.newTask')" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="i-lucide:plus"
              variant="text"
              size="x-small"
              class="text-muted"
              @click="store.createSession()"
            />
          </template>
        </v-tooltip>
      </div>
    </div>

    <!-- 当前项目 + 会话列表（list-group：项目为 activator，会话为子项） -->
    <div v-if="projectOpen" class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
      <v-list v-model:opened="opened" class="-mx-1 p-0" nav>
        <v-list-group value="project">
          <template #activator="{ props: activatorProps }">
            <v-list-item
              v-bind="activatorProps"
              prepend-icon="i-lucide:folder"
              class="mb-0.5 bg-elevated"
            >
              <v-list-item-title class="truncate text-sm">{{ projectName }}</v-list-item-title>
            </v-list-item>
          </template>

          <v-list-item
            v-for="s in filteredSessions"
            :key="s.id"
            :active="s.id === activeSessionId"
            class="mb-0.5"
            @click="store.select(s.id)"
          >
            <v-list-item-title class="truncate text-sm">
              {{ s.title || t('session.new') }}
            </v-list-item-title>
          </v-list-item>
        </v-list-group>
      </v-list>
      <div v-if="!filteredSessions.length" class="py-2 text-sm text-faint">
        {{ keyword ? t('session.notFound') : t('session.empty') }}
      </div>
    </div>
    <div v-else class="flex-1" />
  </div>
</template>
