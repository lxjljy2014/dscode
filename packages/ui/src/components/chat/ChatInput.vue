<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Command, PermissionMode } from '@dscode/shared';
import { useSessionStore } from '../../stores/session';
import { useSettingsStore } from '../../stores/settings';
import { usePluginsStore } from '../../stores/plugins';
import GitBranchMenu from '../git/GitBranchMenu.vue';
import PermissionSelector from './PermissionSelector.vue';
import ProjectPicker from './ProjectPicker.vue';
import ContextMeter from './ContextMeter.vue';
import CommandCard from './CommandCard.vue';

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
/** 可用技能合成的斜杠条目：/name 展开为技能完整指令 + 用户补充的任务描述 */
const skillCommands = computed<Command[]>(() =>
  (settingsStore.settings.skills ?? []).map(s => ({
    id: `skill-${s.id}`,
    name: s.name,
    description: s.description,
    prompt: `请按下述技能指令执行任务：\n\n【技能 ${s.name}】${s.description}\n\n${s.instructions}`,
    input: '[<task>]',
    kind: 'skill' as const
  }))
);
const commands = computed<Command[]>(() => [
  ...(settingsStore.settings.commands ?? []),
  ...pluginsStore.commands,
  ...skillCommands.value
]);
void pluginsStore.load();

// 斜杠命令卡片状态（组合框：输入框保持焦点，卡片只读展示，过滤词随输入同步）
const commandOpen = ref(false);
const commandKeyword = ref('');
const commandActive = ref(0);

/** 判断输入末尾是否为「正在输入」的斜杠命令：最后一行以 / 开头且尚未出现空格（如 /expl） */
function activeSlashQuery(text: string): string | null {
  const last = text.split('\n').at(-1) ?? '';
  const m = /^\/([^\s/]*)$/.exec(last);
  return m ? m[1] : null;
}

// 输入变化时：末尾是 /query 则打开命令卡片并同步关键词，否则关闭
watch(input, value => {
  const query = activeSlashQuery(value);
  if (query !== null) {
    commandKeyword.value = query;
    commandActive.value = 0;
    commandOpen.value = true;
  } else {
    commandOpen.value = false;
  }
});

/** 按关键词过滤命令（名称 + 说明不区分大小写），供列表展示与键盘导航共用 */
const filteredCommands = computed(() => {
  const k = commandKeyword.value.trim().toLowerCase();
  if (!k) return commands.value;
  return commands.value.filter(c => `${c.name} ${c.description}`.toLowerCase().includes(k));
});

// 过滤结果按分组拆分（普通命令在前、技能在后，扁平下标顺序与 CommandCard 一致）
const filteredGroupCommands = computed(() => filteredCommands.value.filter(c => c.kind !== 'skill'));
const filteredGroupSkills = computed(() => filteredCommands.value.filter(c => c.kind === 'skill'));

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

/** 命令执行结果反馈（snackbar） */
const feedback = ref('');
const feedbackShow = ref(false);
function notify(text: string) {
  feedback.value = text;
  feedbackShow.value = true;
}

/** 权限模式合法值（与 settings 的 PermissionMode 对齐） */
const PERMISSION_MODES: PermissionMode[] = ['confirm', 'auto-edit', 'plan', 'full-access'];
/** 进入计划模式前的权限模式，/plan off 时恢复 */
const prePlanMode = ref<PermissionMode>('confirm');

/** 动作命令执行结果：handled 是否已消费；send 存在时需作为本轮提示词发送 */
interface ActionResult {
  handled: boolean;
  send?: string;
}

/**
 * 执行内置动作命令（permission/plan/model）。
 * @param cmd 命中的命令
 * @param rest 命令名之后的参数（去首尾空白）
 */
async function runAction(cmd: Command, rest: string): Promise<ActionResult> {
  const arg = rest.trim();
  switch (cmd.action) {
    case 'permission': {
      const preset = arg.toLowerCase() as PermissionMode;
      if (!arg) {
        notify(`${t('command.permissionCurrent')} ${settingsStore.settings.permissionMode}`);
        return { handled: true };
      }
      if (!PERMISSION_MODES.includes(preset)) {
        notify(t('command.permissionInvalid', { value: arg }));
        return { handled: true };
      }
      await settingsStore.save({ permissionMode: preset });
      notify(`${t('command.permissionSwitched')} ${preset}`);
      return { handled: true };
    }
    case 'plan': {
      if (arg === 'off') {
        await settingsStore.save({ permissionMode: prePlanMode.value });
        notify(t('command.planOff'));
        return { handled: true };
      }
      // 仅在非计划模式下记录回退目标，避免 /plan off 时回退到 plan 自身
      if (settingsStore.settings.permissionMode !== 'plan') {
        prePlanMode.value = settingsStore.settings.permissionMode;
      }
      await settingsStore.save({ permissionMode: 'plan' });
      notify(t('command.planOn'));
      // /plan <message>：进入计划模式并把消息作为本轮提示词发送（对齐 DSH）
      return arg ? { handled: true, send: arg } : { handled: true };
    }
    case 'model': {
      if (!arg) {
        notify(`${t('command.modelCurrent')} ${model.value}`);
        return { handled: true };
      }
      if (!models.value.includes(arg)) {
        notify(t('command.modelInvalid', { value: arg, list: models.value.join(', ') }));
        return { handled: true };
      }
      model.value = arg;
      notify(`${t('command.modelSwitched')} ${arg}`);
      return { handled: true };
    }
    default:
      return { handled: false };
  }
}

function applyCommand(cmd: Command) {
  // 选中命令：把 /命令名 写入输入框末尾（留一个空格便于继续输入参数），提交时再展开/执行
  const lines = input.value.split('\n');
  lines[lines.length - 1] = `/${cmd.name} `;
  input.value = lines.join('\n');
  commandOpen.value = false;
}

/** 选中当前高亮命令并应用到输入框 */
function selectActiveCommand(): void {
  const cmd = filteredCommands.value[commandActive.value];
  if (cmd) applyCommand(cmd);
}

/** 点击 / 按钮：在末尾补一个 / 触发命令卡片（组合框保持输入框焦点） */
function insertSlash(): void {
  const v = input.value;
  input.value = v && !v.endsWith('\n') ? v + '\n/' : v + '/';
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

/** 解析 /name 形式，返回命中的命令与其余文本；非命令返回 null */
function parseCommand(content: string): { cmd: Command; rest: string } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('/')) return null;
  const m = trimmed.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const cmd = commands.value.find(c => c.name === m[1]);
  return cmd ? { cmd, rest: m[2] ?? '' } : null;
}

function submit() {
  const trimmed = input.value.trim();
  if (!trimmed || props.generating) return;
  const parsed = parseCommand(trimmed);
  // 内置动作命令：直接执行，不发消息（/plan <message> 会把消息作为本轮提示词发送）
  if (parsed?.cmd.action) {
    void runAction(parsed.cmd, parsed.rest).then(result => {
      if (!result.handled) return;
      input.value = '';
      if (result.send) emit('send', result.send, model.value, subagentId.value);
    });
    return;
  }
  const content = expandCommand(trimmed);
  emit('send', content, model.value, subagentId.value);
  input.value = '';
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return;

  // 命令卡片打开时：↑/↓ 高亮、Enter 应用、Esc 关闭（不触发发送）
  if (commandOpen.value) {
    const len = Math.max(filteredCommands.value.length, 1);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        commandActive.value = (commandActive.value + 1) % len;
        break;
      case 'ArrowUp':
        e.preventDefault();
        commandActive.value = (commandActive.value - 1 + len) % len;
        break;
      case 'Enter':
        e.preventDefault();
        selectActiveCommand();
        break;
      case 'Escape':
        e.preventDefault();
        commandOpen.value = false;
        break;
    }
    return;
  }

  // 输入法组合中不触发发送
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
}
</script>

<template>
  <VSheet class="relative flex flex-col" rounded="2xl">
    <!-- 斜杠命令卡片：输入框上方弹出的命令面板（组合框，输入框保持焦点） -->
    <CommandCard
      v-if="commandOpen"
      :commands="filteredGroupCommands"
      :skills="filteredGroupSkills"
      :active="commandActive"
      @select="applyCommand"
      @hover="commandActive = $event"
    />

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

      <div class="flex items-center gap-1 px-2 pb-1">
        <VMenu location="top" :offset="4">
          <template #activator="{ props: menuProps }">
            <VTooltip :text="t('input.addContext')" location="top">
              <template #activator="{ props: tipProps }">
                <VIconBtn
                  v-bind="{ ...menuProps, ...tipProps }"
                  icon="i-lucide:plus"
                  variant="text"
                  size="small"
                  class="text-muted"
                />
              </template>
            </VTooltip>
          </template>
          <VList min-width="220" nav>
            <VListItem prepend-icon="i-lucide:paperclip" @click="insertSlash">
              <VListItemTitle class="text-sm">添加附件</VListItemTitle>
            </VListItem>
            <VListItem prepend-icon="i-lucide:at-sign" @click="insertSlash">
              <VListItemTitle class="text-sm">使用 @ 添加上下文</VListItemTitle>
            </VListItem>
            <VListItem prepend-icon="i-lucide:square-slash" @click="insertSlash">
              <VListItemTitle class="text-sm">使用 / 选择命令或能力</VListItemTitle>
            </VListItem>
          </VList>
        </VMenu>
        <!-- 斜杠命令：点击在输入框末尾补 /，触发命令卡片 -->
        <!--        <VTooltip :text="t('input.commandTitle')" location="top">-->
        <!--          <template #activator="{ props: tipProps }">-->
        <!--            <VIconBtn-->
        <!--              v-bind="tipProps"-->
        <!--              icon="i-lucide:slash"-->
        <!--              variant="text"-->
        <!--              size="small"-->
        <!--              class="text-muted"-->
        <!--              @click="insertSlash"-->
        <!--            />-->
        <!--          </template>-->
        <!--        </VTooltip>-->

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

    <!-- 命令执行结果提示 -->
    <VSnackbar v-model="feedbackShow" :timeout="2500" location="top">
      {{ feedback }}
    </VSnackbar>
  </VSheet>
</template>
