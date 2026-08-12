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
  <VSheet class="flex flex-col" rounded="2xl">
    <div v-if="!sessionStore.hasMessage" class="flex gap-2 px-2 py-1">
      <!-- 项目选择条 -->
      <VMenu location="top start" :offset="4">
        <template #activator="{ props: menuProps }">
          <VBtn
            v-bind="menuProps"
            variant="text"
            rounded="pill"
            size="small"
            class="text-muted"
            prepend-icon="i-lucide:folder"
            append-icon="i-lucide:chevron-down"
          >
            {{ t('input.selectProject') }}
          </VBtn>
        </template>
        <VList min-width="200" nav>
          <VListItem active prepend-icon="i-lucide:folder">
            <VListItemTitle class="text-sm">dscode</VListItemTitle>
            <template #append>
              <VIcon icon="i-lucide:check" size="16" />
            </template>
          </VListItem>
        </VList>
      </VMenu>
      <!--      git 分支-->
      <VMenu location="top start" :offset="4">
        <template #activator="{ props: menuProps }">
          <VBtn
            v-bind="menuProps"
            variant="text"
            rounded="pill"
            size="small"
            class="text-muted"
            prepend-icon="i-lucide:git-branch"
            append-icon="i-lucide:chevron-down"
          >
            {{ t('input.gitBranch') }}
          </VBtn>
        </template>
        <VList min-width="200" nav>
          <VListItem active prepend-icon="i-lucide:folder">
            <VListItemTitle class="text-sm">dscode</VListItemTitle>
            <template #append>
              <VIcon icon="i-lucide:check" size="16" />
            </template>
          </VListItem>
        </VList>
      </VMenu>
    </div>

    <!-- 输入卡片 -->
    <div class="rounded-2xl border bg-elevated">
      <VTextarea
        v-model="input"
        :placeholder="t('chat.placeholder')"
        variant="solo"
        density="compact"
        flat
        rows="2"
        max-rows="5"
        auto-grow
        bg-color="elevated"
        hide-details
        @keydown="onKeydown"
      />

      <div class="flex items-center gap-1 px-2 pb-2">
        <VTooltip :text="t('input.addContext')" location="top">
          <template #activator="{ props: tipProps }">
            <VBtn v-bind="tipProps" icon="i-lucide:plus" variant="text" size="small" class="text-muted" />
          </template>
        </VTooltip>

        <!-- 模式选择 -->
        <VMenu location="top start" :offset="4">
          <template #activator="{ props: menuProps }">
            <VBtn
              v-bind="menuProps"
              variant="text"
              size="small"
              class="px-2 text-muted"
              prepend-icon="i-lucide:clipboard-list"
              append-icon="i-lucide:chevron-down"
            >
              {{ mode === 'plan' ? t('input.planMode') : t('input.agentMode') }}
            </VBtn>
          </template>
          <VList min-width="140" nav>
            <VListItem v-for="m in modes" :key="m" :active="mode === m" @click="mode = m">
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

        <!-- 模型选择 -->
        <VMenu location="top end" :offset="4">
          <template #activator="{ props: menuProps }">
            <VBtn
              v-bind="menuProps"
              variant="text"
              size="small"
              class="px-2 text-muted"
              append-icon="i-lucide:chevron-down"
            >
              {{ model }}
            </VBtn>
          </template>
          <VList min-width="220" nav>
            <VListItem v-for="m in models" :key="m" :active="model === m" @click="model = m">
              <VListItemTitle>{{ m }}</VListItemTitle>
              <template #append>
                <VIcon v-if="model === m" icon="i-lucide:check" size="16" />
              </template>
            </VListItem>
          </VList>
        </VMenu>

        <!-- 推理强度 -->
        <VMenu location="top end" :offset="4">
          <template #activator="{ props: menuProps }">
            <VBtn
              v-bind="menuProps"
              variant="text"
              size="small"
              class="px-2 text-muted"
              prepend-icon="i-lucide:brain"
              append-icon="i-lucide:chevron-down"
            >
              {{ t(`input.effort.${effort}`) }}
            </VBtn>
          </template>
          <VList min-width="120" nav>
            <VListItem v-for="e in efforts" :key="e" :active="effort === e" @click="effort = e">
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
              color="primary"
              size="small"
              :disabled="!generating && !input.trim()"
              @click="generating ? emit('stop') : submit()"
            />
          </template>
        </VTooltip>
      </div>
    </div>
  </VSheet>
</template>
