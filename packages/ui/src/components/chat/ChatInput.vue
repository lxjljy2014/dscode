<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../../stores/session';
import { useSettingsStore } from '../../stores/settings';
import { usePluginsStore } from '../../stores/plugins';
import GitBranchMenu from '../git/GitBranchMenu.vue';
import PermissionSelector from './PermissionSelector.vue';
import ProjectPicker from './ProjectPicker.vue';
import ContextMeter from './ContextMeter.vue';

const props = defineProps<{ generating: boolean }>();
const emit = defineEmits<{
  send: [content: string, model: string, subagentId: string];
  stop: [];
}>();

const { t } = useI18n();
const sessionStore = useSessionStore();
const settingsStore = useSettingsStore();
const input = ref('');

// 模型列表来自 settings.providers[0].models（设置加载后同步；当前选中值失效时回退列表第一项）
const model = ref('');
const models = computed(() => settingsStore.settings.providers[0]?.models ?? []);
watch(
  () => settingsStore.settings.providers,
  providers => {
    const list = providers[0]?.models ?? [];
    if (list.length && !list.includes(model.value)) model.value = list[0];
  },
  { immediate: true, deep: true }
);

// 自定义斜杠命令 + 插件贡献的命令（/name 展开为 prompt）
const pluginsStore = usePluginsStore();
const commands = computed(() => [...(settingsStore.settings.commands ?? []), ...pluginsStore.commands]);
void pluginsStore.load();

// 子智能体（选定后以其系统提示词运行；空 = 默认）
const subagentId = ref('');
const subagents = computed(() => settingsStore.settings.subagents ?? []);
const subagentName = computed(() => subagents.value.find(s => s.id === subagentId.value)?.name ?? '');
watch(
  () => settingsStore.settings.subagents,
  list => {
    if (subagentId.value && !list.some(s => s.id === subagentId.value)) subagentId.value = '';
  },
  { immediate: true, deep: true }
);

const effort = ref<'close' | 'high' | 'max'>('max');
const efforts = ['close', 'high', 'max'] as const;

function applyCommand(cmd: { prompt: string }) {
  input.value = cmd.prompt;
}

/** 发送前展开 /name 形式：命中自定义命令则替换为 prompt + 其余文本 */
function expandCommand(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('/')) return content;
  const m = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return content;
  const name = m[1];
  const rest = m[2] ?? '';
  const cmd = commands.value.find(c => c.name === name);
  if (!cmd) return content;
  return [cmd.prompt, rest].filter(Boolean).join('\n');
}

function submit() {
  const content = expandCommand(input.value.trim());
  if (!content || props.generating) return;
  emit('send', content, model.value, subagentId.value);
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
    <!-- 顶部上下文 chip 条：仅空会话显示（有消息时选择器在 AppHeader，工作空间已锁定） -->
    <div v-if="!sessionStore.hasMessage" class="flex gap-2 px-2 py-1">
      <ProjectPicker />
      <!-- 项目分支：真实 git 分支选择（与 AppHeader 共用 GitBranchMenu） -->
      <GitBranchMenu />
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
        rounded="2xl"
        bg-color="elevated"
        hide-details
        @keydown="onKeydown"
      />

      <div class="flex items-center gap-1 px-2">
        <VTooltip :text="t('input.addContext')" location="top">
          <template #activator="{ props: tipProps }">
            <VBtn v-bind="tipProps" icon="i-lucide:plus" variant="text" size="small" class="text-muted" />
          </template>
        </VTooltip>

        <!-- 斜杠命令 -->
        <VMenu location="top start" :offset="4">
          <template #activator="{ props: menuProps }">
            <VBtn v-bind="menuProps" icon="i-lucide:slash" variant="text" size="small" class="text-muted" />
          </template>
          <VList min-width="300" nav max-height="320">
            <VListItem v-for="c in commands" :key="c.id" @click="applyCommand(c)">
              <VListItemTitle class="text-sm">
                <code class="font-mono text-primary">/{{ c.name }}</code>
                <span class="ml-2 text-muted">{{ c.description }}</span>
              </VListItemTitle>
            </VListItem>
            <div v-if="!commands.length" class="px-4 py-3 text-xs text-faint">
              {{ t('settingsPage.commands.empty') }}
            </div>
          </VList>
        </VMenu>

        <!-- 权限模式 -->
        <PermissionSelector />

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

        <!-- 子智能体 -->
        <VMenu location="top end" :offset="4">
          <template #activator="{ props: menuProps }">
            <VBtn
              v-bind="menuProps"
              variant="text"
              size="small"
              class="px-2 text-muted"
              prepend-icon="i-lucide:briefcase"
              append-icon="i-lucide:chevron-down"
            >
              {{ subagentId ? subagentName : t('input.subagentDefault') }}
            </VBtn>
          </template>
          <VList min-width="220" nav>
            <VListItem :active="!subagentId" @click="subagentId = ''">
              <VListItemTitle class="text-sm">{{ t('input.subagentDefault') }}</VListItemTitle>
              <template #append>
                <VIcon v-if="!subagentId" icon="i-lucide:check" size="16" />
              </template>
            </VListItem>
            <VListItem v-for="s in subagents" :key="s.id" :active="subagentId === s.id" @click="subagentId = s.id">
              <VListItemTitle class="text-sm">{{ s.name }}</VListItemTitle>
              <VListItemSubtitle v-if="s.description" class="text-xs">{{ s.description }}</VListItemSubtitle>
              <template #append>
                <VIcon v-if="subagentId === s.id" icon="i-lucide:check" size="16" />
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

        <!-- 上下文占用环形进度（发送按钮左侧） -->
        <ContextMeter />

        <VTooltip :text="generating ? t('chat.stop') : t('chat.send')" location="top">
          <template #activator="{ props: tipProps }">
            <VBtn
              v-bind="tipProps"
              :icon="generating ? 'i-lucide:square' : 'i-lucide:arrow-up'"
              color="primary"
              density="comfortable"
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
