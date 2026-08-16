<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Command } from '@dscode/shared';

/**
 * 斜杠命令卡片：输入框上方弹出的命令面板（组合框——输入框保持焦点，卡片只读展示）。
 * 父级（ChatInput）负责过滤、↑/↓ 高亮与 Enter/Esc 键盘控制；本组件按「命令 / 技能」
 * 分组呈现过滤后的条目，并把点击/悬停反馈上抛。active 为跨分组的扁平下标
 * （commands 在前、skills 在后），父级按键导航据此工作。
 */

const props = defineProps<{
  /** 已过滤的普通命令列表 */
  commands: Command[];
  /** 已过滤的技能条目列表 */
  skills: Command[];
  /** 当前高亮下标（扁平：先 commands 后 skills） */
  active: number;
}>();

const emit = defineEmits<{
  select: [command: Command];
  hover: [index: number];
}>();

const { t } = useI18n();

/** 技能分组在扁平下标中的起始位置（commands 占前 skills.length 之外的段） */
const skillOffset = () => props.commands.length;

/** 列表容器：高亮项移出可视区时滚动进视野 */
const listRef = ref<HTMLElement>();

watch(
  () => props.active,
  async () => {
    await nextTick();
    listRef.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }
);
</script>

<template>
  <div class="absolute bottom-full left-0 right-0 z-10 mb-2">
    <!-- 菜单表面色（与 ProjectPicker 等弹出菜单一致），与输入卡片的 bg-elevated 区分层次 -->
    <VCard rounded="2xl" class="border border-line bg-surface" elevation="8">
      <div v-if="commands.length || skills.length" ref="listRef" class="max-h-64 overflow-y-auto px-1 py-1">
        <!-- 命令分组 -->
        <template v-if="commands.length">
          <div class="px-2 pb-1 pt-1.5 text-[11px] font-medium text-faint">
            {{ t('input.commandGroup') }}
          </div>
          <VList nav density="compact">
            <VListItem
              v-for="(c, i) in commands"
              :key="c.id"
              :data-active="i === active"
              :class="{ 'bg-primary/12': i === active }"
              rounded="lg"
              @click="emit('select', c)"
              @mouseenter="emit('hover', i)"
            >
              <VListItemTitle class="text-sm">
                <span class="flex items-center gap-2">
                  <code class="shrink-0 font-mono text-primary">/{{ c.name }}</code>
                  <span class="min-w-0 flex-1 truncate text-xs text-muted">{{ c.description }}</span>
                </span>
              </VListItemTitle>
              <VListItemSubtitle v-if="c.input" class="font-mono text-[11px] text-faint">
                {{ c.input }}
              </VListItemSubtitle>
            </VListItem>
          </VList>
        </template>

        <!-- 技能分组 -->
        <template v-if="skills.length">
          <div class="px-2 pb-1 pt-2 text-[11px] font-medium text-faint">
            {{ t('input.skillGroup') }}
          </div>
          <VList nav density="compact">
            <VListItem
              v-for="(c, i) in skills"
              :key="c.id"
              :data-active="skillOffset() + i === active"
              :class="{ 'bg-primary/12': skillOffset() + i === active }"
              rounded="lg"
              @click="emit('select', c)"
              @mouseenter="emit('hover', skillOffset() + i)"
            >
              <VListItemTitle class="text-sm">
                <span class="flex items-center gap-2">
                  <code class="shrink-0 font-mono text-primary">/{{ c.name }}</code>
                  <span class="min-w-0 flex-1 truncate text-xs text-muted">{{ c.description }}</span>
                </span>
              </VListItemTitle>
              <VListItemSubtitle v-if="c.input" class="font-mono text-[11px] text-faint">
                {{ c.input }}
              </VListItemSubtitle>
            </VListItem>
          </VList>
        </template>
      </div>

      <div v-else class="px-4 py-3 text-xs text-faint">{{ t('input.commandEmpty') }}</div>

      <!-- 键位提示 -->
      <VDivider class="border-line" />
      <div class="select-none px-3.5 pb-2 pt-1.5 text-[11px] text-faint">
        {{ t('input.commandHint') }}
      </div>
    </VCard>
  </div>
</template>
