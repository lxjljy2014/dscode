<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ generating: boolean }>()
const emit = defineEmits<{
  send: [content: string]
  stop: []
}>()

const { t } = useI18n()
const input = ref('')

// 以下为占位选择器状态，接入真实 agent 后改为从配置/store 读取
const mode = ref<'plan' | 'agent'>('plan')
const modes = ['plan', 'agent'] as const

const model = ref('deepseek/deepseek-v4-flash')
const models = ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro']

const effort = ref<'low' | 'medium' | 'high' | 'max'>('max')
const efforts = ['low', 'medium', 'high', 'max'] as const

function submit() {
  const content = input.value.trim()
  if (!content || props.generating) return
  emit('send', content)
  input.value = ''
}

function onKeydown(e: KeyboardEvent) {
  // 输入法组合中不触发发送
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- 项目选择条 -->
    <v-menu location="top start" :offset="4">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          variant="text"
          rounded="xl"
          class="shrink-0 self-start border border-line bg-elevated px-3 text-muted"
          prepend-icon="i-lucide:folder"
          append-icon="i-lucide:chevron-down"
        >
          {{ t('input.selectProject') }}
        </v-btn>
      </template>
        <v-list min-width="200" nav>
          <v-list-item active prepend-icon="i-lucide:folder">
            <v-list-item-title class="text-sm">dscode</v-list-item-title>
            <template #append>
              <v-icon icon="i-lucide:check" size="16" />
            </template>
          </v-list-item>
        </v-list>

    </v-menu>

    <!-- 输入卡片 -->
    <div class="rounded-2xl border border-line bg-elevated">
      <v-textarea
        v-model="input"
        :placeholder="t('chat.placeholder')"
        variant="plain"
        auto-grow
        rows="2"
        max-rows="5"
        @keydown="onKeydown"
      />

      <div class="flex items-center gap-1 px-2 pb-2">
        <v-tooltip :text="t('input.addContext')" location="top">
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="i-lucide:plus" variant="text" size="small" class="text-muted" />
          </template>
        </v-tooltip>

        <!-- 模式选择 -->
        <v-menu location="top start" :offset="4">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              variant="text"
              size="small"
              class="px-2 text-muted"
              prepend-icon="i-lucide:clipboard-list"
              append-icon="i-lucide:chevron-down"
            >
              {{ mode === 'plan' ? t('input.planMode') : t('input.agentMode') }}
            </v-btn>
          </template>
            <v-list min-width="140" nav>
              <v-list-item
                  v-for="m in modes"
                  :key="m"
                  :active="mode === m"
                  @click="mode = m"
              >
                <v-list-item-title class="text-sm">
                  {{ m === 'plan' ? t('input.planMode') : t('input.agentMode') }}
                </v-list-item-title>
                <template #append>
                  <v-icon v-if="mode === m" icon="i-lucide:check" size="16" />
                </template>
              </v-list-item>
            </v-list>
        </v-menu>

        <v-spacer />

        <!-- 模型选择 -->
        <v-menu location="top end" :offset="4">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              variant="text"
              size="small"
              class="px-2 text-muted"
              append-icon="i-lucide:chevron-down"
            >
              {{ model }}
            </v-btn>
          </template>
            <v-list min-width="220" nav>
              <v-list-item
                  v-for="m in models"
                  :key="m"
                  :active="model === m"
                  @click="model = m"
              >
                <v-list-item-title>{{ m }}</v-list-item-title>
                <template #append>
                  <v-icon v-if="model === m" icon="i-lucide:check" size="16" />
                </template>
              </v-list-item>
            </v-list>
        </v-menu>

        <!-- 推理强度 -->
        <v-menu location="top end" :offset="4">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              variant="text"
              size="small"
              class="px-2 text-muted"
              prepend-icon="i-lucide:brain"
              append-icon="i-lucide:chevron-down"
            >
              {{ t(`input.effort.${effort}`) }}
            </v-btn>
          </template>
            <v-list min-width="120" class="p-1">
              <v-list-item
                  v-for="e in efforts"
                  :key="e"
                  :active="effort === e"
                  @click="effort = e"
              >
                <v-list-item-title class="text-sm">{{ t(`input.effort.${e}`) }}</v-list-item-title>
                <template #append>
                  <v-icon v-if="effort === e" icon="i-lucide:check" size="16" />
                </template>
              </v-list-item>
            </v-list>

        </v-menu>

        <v-tooltip :text="generating ? t('chat.stop') : t('chat.send')" location="top">
          <template #activator="{ props: tipProps }">
            <v-btn
              v-bind="tipProps"
              :icon="generating ? 'i-lucide:square' : 'i-lucide:arrow-up'"
              color="primary"
              size="small"
              :disabled="!generating && !input.trim()"
              @click="generating ? emit('stop') : submit()"
            />
          </template>
        </v-tooltip>
      </div>
    </div>
  </div>
</template>
