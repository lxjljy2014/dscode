<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../stores/session';

const props = defineProps<{ generating: boolean }>();
const emit = defineEmits<{
  send: [content: string];
  stop: [];
}>();

const { t } = useI18n();
const sessionStore = useSessionStore();
const input = ref('');

// 以下为占位选择器状态，接入真实 agent 后改为从配置/store 读取
const mode = ref<'plan' | 'agent'>('plan');
const modes = ['plan', 'agent'] as const;

const model = ref('deepseek/deepseek-v4-flash');
const models = ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro'];

const effort = ref<'close' | 'high' | 'max'>('max');
const efforts = ['close', 'high', 'max'] as const;

function submit() {
  const content = input.value.trim();
  if (!content || props.generating) return;
  emit('send', content);
  input.value = '';
}

function onKeydown(e: KeyboardEvent) {
  // 输入法组合中不触发发送
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
}
</script>

<template>
  <!-- 外层卡片：surface-variant 底，包住顶部 chip 条与输入卡 -->
  <VSheet class="flex flex-col" rounded="2xl" color="surface-variant">
    <!-- 顶部上下文 chip 条：仅空会话显示（有消息时选择器在 AppHeader，工作空间已锁定） -->
    <div v-if="!sessionStore.hasMessage" class="flex gap-2 px-4 py-2">
      <!-- 项目选择 -->
      <VMenu location="top start" :offset="4">
        <template #activator="{ props: menuProps }">
          <VBtn
            v-bind="menuProps"
            flat
            variant="text"
            size="small"
            rounded="pill"
            prepend-icon="i-lucide:folder"
            append-icon="i-lucide:chevron-down"
            class="text-muted"
          >
            {{ t('input.selectProject') }}
          </VBtn>
        </template>
        <VList min-width="200" nav density="compact">
          <VListItem active rounded="pill" prepend-icon="i-lucide:folder">
            <VListItemTitle class="text-sm">dscode</VListItemTitle>
            <template #append>
              <VIcon icon="i-lucide:check" size="16" />
            </template>
          </VListItem>
        </VList>
      </VMenu>
      <!-- git 分支 -->
      <VMenu location="top start" :offset="4">
        <template #activator="{ props: menuProps }">
          <VBtn
            v-bind="menuProps"
            flat
            variant="text"
            size="small"
            rounded="pill"
            prepend-icon="i-lucide:git-branch"
            append-icon="i-lucide:chevron-down"
            class="text-muted"
          >
            {{ t('input.gitBranch') }}
          </VBtn>
        </template>
        <VList min-width="200" nav density="compact">
          <VListItem active rounded="pill" prepend-icon="i-lucide:folder">
            <VListItemTitle class="text-sm">dscode</VListItemTitle>
            <template #append>
              <VIcon icon="i-lucide:check" size="16" />
            </template>
          </VListItem>
        </VList>
      </VMenu>
    </div>

    <!-- 输入卡片 -->
    <VSheet class="rounded-2xl" border color="surface">
      <VTextarea
        v-model="input"
        :placeholder="t('chat.placeholder')"
        variant="solo"
        density="compact"
        flat
        rows="2"
        max-rows="5"
        auto-grow
        rounded="2xl"
        bg-color="surface"
        hide-details
        @keydown="onKeydown"
      />

      <div class="flex items-center gap-1 px-3 py-2">
        <!-- 左：添加上下文 + 模式选择 -->
        <VTooltip :text="t('input.addContext')" location="top">
          <template #activator="{ props: tipProps }">
            <VBtn v-bind="tipProps" icon="i-lucide:plus" variant="text" size="small" rounded="lg" class="text-muted" />
          </template>
        </VTooltip>

        <VMenu location="top start" :offset="4">
          <template #activator="{ props: menuProps }">
            <VBtn
              v-bind="menuProps"
              flat
              variant="text"
              size="small"
              rounded="pill"
              prepend-icon="i-lucide:clipboard-list"
              append-icon="i-lucide:chevron-down"
              class="px-2 text-muted"
            >
              {{ mode === 'plan' ? t('input.planMode') : t('input.agentMode') }}
            </VBtn>
          </template>
          <VList min-width="140" nav density="compact">
            <VListItem v-for="m in modes" :key="m" :active="mode === m" rounded="pill" @click="mode = m">
              <VListItemTitle class="text-sm">
                {{ m === 'plan' ? t('input.planMode') : t('input.agentMode') }}
              </VListItemTitle>
              <template #append>
                <VIcon v-if="mode === m" icon="i-lucide:check" size="16" />
              </template>
            </VListItem>
          </VList>
        </VMenu>

        <VSpacer />

        <!-- 右：模型 + 推理强度 + 发送/停止 -->
        <VMenu location="top end" :offset="4">
          <template #activator="{ props: menuProps }">
            <VBtn
              v-bind="menuProps"
              flat
              variant="text"
              size="small"
              rounded="pill"
              append-icon="i-lucide:chevron-down"
              class="px-2 text-muted"
            >
              {{ model }}
            </VBtn>
          </template>
          <VList min-width="220" nav density="compact">
            <VListItem v-for="m in models" :key="m" :active="model === m" rounded="pill" @click="model = m">
              <VListItemTitle>{{ m }}</VListItemTitle>
              <template #append>
                <VIcon v-if="model === m" icon="i-lucide:check" size="16" />
              </template>
            </VListItem>
          </VList>
        </VMenu>

        <VMenu location="top end" :offset="4">
          <template #activator="{ props: menuProps }">
            <VBtn
              v-bind="menuProps"
              flat
              variant="text"
              size="small"
              rounded="pill"
              prepend-icon="i-lucide:brain"
              append-icon="i-lucide:chevron-down"
              class="px-2 text-muted"
            >
              {{ t(`input.effort.${effort}`) }}
            </VBtn>
          </template>
          <VList min-width="120" nav density="compact">
            <VListItem v-for="e in efforts" :key="e" :active="effort === e" rounded="pill" @click="effort = e">
              <VListItemTitle class="text-sm">{{ t(`input.effort.${e}`) }}</VListItemTitle>
              <template #append>
                <VIcon v-if="effort === e" icon="i-lucide:check" size="16" />
              </template>
            </VListItem>
          </VList>
        </VMenu>

        <VTooltip :text="generating ? t('chat.stop') : t('chat.send')" location="top">
          <template #activator="{ props: tipProps }">
            <VBtn
              v-bind="tipProps"
              :icon="generating ? 'i-lucide:square' : 'i-lucide:arrow-up'"
              :color="generating ? 'error' : 'primary'"
              :variant="generating ? 'tonal' : undefined"
              size="small"
              rounded="lg"
              :disabled="!generating && !input.trim()"
              @click="generating ? emit('stop') : submit()"
            />
          </template>
        </VTooltip>
      </div>
    </VSheet>
  </VSheet>
</template>
