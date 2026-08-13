<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PermissionMode } from '@dscode/shared';
import { host } from '../host';
import { useSessionStore } from '../stores/session';
import { useSettingsStore } from '../stores/settings';
import GitBranchMenu from './GitBranchMenu.vue';

const props = defineProps<{ generating: boolean }>();
const emit = defineEmits<{
  send: [content: string];
  stop: [];
}>();

const { t } = useI18n();
const sessionStore = useSessionStore();
const settingsStore = useSettingsStore();
const input = ref('');

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

// ---- 项目选择 ----
const recentProjects = ref<Array<{ path: string; name: string; lastOpenedAt: number }>>([]);
const homeDir = ref('');
const projectMenuOpen = ref(false);
const snackbarText = ref('');
const snackbarShow = ref(false);

function dirName(p: string): string {
  return (
    p
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || p
  );
}

/** 当前项目名：工作目录 basename（未选择时显示"选择项目"） */
const currentProject = computed(() => {
  const wd = settingsStore.settings.workingDirectory;
  return wd ? dirName(wd) : '';
});

async function loadProjects(): Promise<void> {
  if (!host) return;
  const r = await host.listRecentProjects();
  recentProjects.value = r.projects;
  homeDir.value = r.homeDir;
}

function onProjectMenu(open: boolean): void {
  if (open) void loadProjects();
}

async function selectProject(path: string): Promise<void> {
  projectMenuOpen.value = false;
  await settingsStore.save({ workingDirectory: path });
}

async function openFolder(): Promise<void> {
  projectMenuOpen.value = false;
  if (!host) return;
  const dir = await host.pickDirectory();
  if (dir) await selectProject(dir);
}

/** 不在项目中工作：工作目录归零到默认（家目录） */
async function resetProject(): Promise<void> {
  if (!homeDir.value) await loadProjects();
  if (!homeDir.value) return;
  await selectProject(homeDir.value);
}

/** 远程连接：暂未实现 */
function remoteConnect(): void {
  projectMenuOpen.value = false;
  snackbarText.value = t('project.remoteNotReady');
  snackbarShow.value = true;
}

// ---- 权限模式 ----
interface PermissionOption {
  value: PermissionMode;
  icon: string;
  label: string;
  hint: string;
}

const PERMISSION_OPTIONS = computed<PermissionOption[]>(() => [
  {
    value: 'confirm',
    icon: 'i-lucide:hand',
    label: t('permission.confirm'),
    hint: t('permission.hintConfirm')
  },
  {
    value: 'auto-edit',
    icon: 'i-lucide:shield-check',
    label: t('permission.autoEdit'),
    hint: t('permission.hintAutoEdit')
  },
  { value: 'plan', icon: 'i-lucide:map', label: t('permission.plan'), hint: t('permission.hintPlan') },
  {
    value: 'full-access',
    icon: 'i-lucide:shield-alert',
    label: t('permission.fullAccess'),
    hint: t('permission.hintFullAccess')
  }
]);

const permMenuOpen = ref(false);
const currentPermLabel = computed(
  () => PERMISSION_OPTIONS.value.find(o => o.value === settingsStore.settings.permissionMode)?.label ?? ''
);

async function selectPermission(value: PermissionMode): Promise<void> {
  permMenuOpen.value = false;
  await settingsStore.save({ permissionMode: value });
}
</script>

<template>
  <VSheet class="flex flex-col" rounded="2xl">
    <!-- 顶部上下文 chip 条：仅空会话显示（有消息时选择器在 AppHeader，工作空间已锁定） -->
    <div v-if="!sessionStore.hasMessage" class="flex gap-2 px-2 py-1">
      <!-- 选择项目：最近项目 + 打开文件夹 + 远程连接 + 不在项目中工作 -->
      <VMenu
        v-model="projectMenuOpen"
        :close-on-content-click="false"
        location="top start"
        :offset="4"
        @update:model-value="onProjectMenu"
      >
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
            {{ currentProject || t('input.selectProject') }}
          </VBtn>
        </template>
        <VCard min-width="300" rounded="16px">
          <VTextField
            density="compact"
            hide-details
            bg-color="surface"
            base-color="surface"
            variant="solo"
            flat
            :placeholder="t('project.search')"
          >
            <template #prepend-inner>
              <VIcon icon="i-lucide:search" size="small" />
            </template>
          </VTextField>
          <VDivider></VDivider>
          <!-- 最近打开的工作空间 -->
          <VList v-if="recentProjects.length > 0" nav density="compact" prepend-gap="12">
            <VListItem
              v-for="p in recentProjects"
              :key="p.path"
              :title="p.name"
              :subtitle="p.path"
              prepend-icon="i-lucide:folder"
              rounded="pill"
              @click="selectProject(p.path)"
            />
          </VList>
          <VList v-else nav density="compact" prepend-gap="12">
            <VListItem :title="t('project.empty')" rounded="pill" disabled />
          </VList>
          <VDivider />
          <VList nav density="compact" prepend-gap="12">
            <VListItem
              :title="t('project.openFolder')"
              prepend-icon="i-lucide:folder-plus"
              rounded="pill"
              @click="openFolder"
            />
            <VListItem
              :title="t('project.remote')"
              rounded="pill"
              prepend-icon="i-lucide:cloud"
              @click="remoteConnect"
            />
            <VListItem
              :title="t('project.noProject')"
              rounded="pill"
              prepend-icon="i-lucide:message-circle"
              @click="resetProject"
            />
          </VList>
        </VCard>
      </VMenu>
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

        <!-- 权限模式 -->
        <VMenu v-model="permMenuOpen" location="top start" :offset="4">
          <template #activator="{ props: menuProps }">
            <VBtn
              v-bind="menuProps"
              :color="settingsStore.settings.permissionMode === 'full-access' ? 'warning' : ''"
              variant="text"
              size="small"
              class="px-2"
              :class="{ 'text-muted': settingsStore.settings.permissionMode !== 'full-access' }"
              :prepend-icon="
                PERMISSION_OPTIONS.find(item => item.value === settingsStore.settings.permissionMode)?.icon
              "
              append-icon="i-lucide:chevron-down"
            >
              {{ currentPermLabel }}
            </VBtn>
          </template>
          <VCard min-width="280" rounded="16px">
            <VList nav density="compact" prepend-gap="12">
              <VListItem
                v-for="opt in PERMISSION_OPTIONS"
                :key="opt.value"
                :title="opt.label"
                :subtitle="opt.hint"
                :prepend-icon="opt.icon"
                :append-icon="settingsStore.settings.permissionMode === opt.value ? 'i-lucide:check' : undefined"
                rounded="pill"
                @click="selectPermission(opt.value)"
              />
            </VList>
          </VCard>
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
              density="comfortable"
              size="small"
              :disabled="!generating && !input.trim()"
              @click="generating ? emit('stop') : submit()"
            />
          </template>
        </VTooltip>
      </div>
    </div>

    <!-- 操作结果提示（错误/未实现等；分支相关提示由 GitBranchMenu 自带） -->
    <VSnackbar v-model="snackbarShow" :timeout="2500">
      {{ snackbarText }}
    </VSnackbar>
  </VSheet>
</template>
