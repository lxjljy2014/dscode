<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEFAULT_SKILLS, type Skill } from '@dscode/shared';
import { useSettingsStore } from '../../stores/settings';

const { t } = useI18n();
const settingsStore = useSettingsStore();

/** 我的技能（用户可编辑/删除；含已添加的内置副本） */
const skills = ref<Skill[]>([]);
watch(
  () => settingsStore.settings.skills,
  list => {
    skills.value = list.map(s => ({ ...s }));
  },
  { immediate: true, deep: true }
);

let seq = 0;
function nextId(): string {
  return 'skill-' + Date.now() + '-' + seq++;
}

const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const draft = ref({ name: '', description: '', instructions: '' });

function openAdd() {
  editingId.value = null;
  draft.value = { name: '', description: '', instructions: '' };
  dialogOpen.value = true;
}

function openEdit(s: Skill) {
  editingId.value = s.id;
  draft.value = { name: s.name, description: s.description, instructions: s.instructions };
  dialogOpen.value = true;
}

function saveDraft() {
  const name = draft.value.name.trim();
  const instructions = draft.value.instructions.trim();
  if (!name || !instructions) return;
  const patch = { name, description: draft.value.description.trim(), instructions };
  if (editingId.value) {
    const s = skills.value.find(x => x.id === editingId.value);
    if (s) Object.assign(s, patch);
  } else {
    skills.value.push({ id: nextId(), ...patch });
  }
  dialogOpen.value = false;
  void persist();
}

function removeSkill(id: string) {
  skills.value = skills.value.filter(s => s.id !== id);
  void persist();
}

async function persist() {
  await settingsStore.save({ skills: skills.value.map(s => ({ ...s })) });
}

/** 我的技能里已存在的内置 id（内置卡片/详情弹窗显示「已添加」） */
const addedBuiltinIds = computed(() => new Set(skills.value.map(s => s.id)));

/** 把某个内置技能加入我的技能（可随后编辑） */
function addBuiltin(d: Skill) {
  skills.value.push({ ...d });
  void persist();
}

/** 内置技能详情弹窗 */
const detailOpen = ref(false);
const detailSkill = ref<Skill | null>(null);
function openDetail(d: Skill) {
  detailSkill.value = d;
  detailOpen.value = true;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="text-xs text-muted">{{ t('settingsPage.skills.desc') }}</div>

    <!-- 内置技能：常驻展示（不依赖用户配置），简洁卡片 + 详情弹窗 -->
    <div>
      <div class="mb-2 flex items-center gap-2">
        <span class="i-lucide:sparkles text-sm text-muted" />
        <span class="text-sm font-medium">{{ t('settingsPage.skills.builtinSection') }}</span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <VCard
          v-for="d in DEFAULT_SKILLS"
          :key="d.id"
          class="cursor-pointer px-4 py-3 transition-colors hover:bg-elevated"
          @click="openDetail(d)"
        >
          <div class="flex items-start gap-3">
            <span class="mt-0.5 shrink-0 text-lg leading-none text-tool-read">
              <span class="i-lucide:wand-sparkles" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <code class="rounded bg-elevated px-1.5 py-0.5 text-xs font-mono">{{ d.name }}</code>
                <span
                  class="shrink-0 rounded border border-line px-1 py-0.5 text-[10px] font-medium leading-none text-muted"
                >
                  {{ t('settingsPage.skills.builtin') }}
                </span>
              </div>
              <div class="mt-1.5 truncate text-sm text-fg">{{ d.description }}</div>
            </div>
          </div>
          <div class="mt-3 flex items-center justify-end gap-2">
            <span class="mr-auto inline-flex items-center gap-1 text-xs text-faint">
              <span class="i-lucide:eye text-3.5" />
              {{ t('settingsPage.skills.viewDetailHint') }}
            </span>
            <VBtn
              v-if="addedBuiltinIds.has(d.id)"
              size="small"
              variant="text"
              prepend-icon="i-lucide:check"
              class="text-faint"
              disabled
            >
              {{ t('settingsPage.skills.added') }}
            </VBtn>
            <VBtn v-else size="small" variant="tonal" prepend-icon="i-lucide:plus" @click.stop="addBuiltin(d)">
              {{ t('settingsPage.skills.addBuiltin') }}
            </VBtn>
          </div>
        </VCard>
      </div>
    </div>

    <!-- 我的技能：可编辑/删除的自定义列表 -->
    <div>
      <div class="mb-2 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="i-lucide:wrench text-sm text-muted" />
          <span class="text-sm font-medium">{{ t('settingsPage.skills.customSection') }}</span>
        </div>
        <VBtn size="small" color="primary" prepend-icon="i-lucide:plus" @click="openAdd">
          {{ t('settingsPage.skills.add') }}
        </VBtn>
      </div>

      <div class="flex flex-col gap-3">
        <VCard
          v-for="s in skills"
          :key="s.id"
          class="cursor-pointer px-4 py-3 transition-colors hover:bg-elevated"
          @click="openEdit(s)"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <code class="rounded bg-elevated px-1.5 py-0.5 text-xs font-mono">{{ s.name }}</code>
                <span
                  v-if="addedBuiltinIds.has(s.id)"
                  class="shrink-0 rounded border border-line px-1 py-0.5 text-[10px] font-medium leading-none text-muted"
                >
                  {{ t('settingsPage.skills.builtin') }}
                </span>
                <span class="truncate text-sm">{{ s.description }}</span>
              </div>
              <div class="mt-2 truncate text-xs leading-5 text-muted">{{ s.instructions }}</div>
            </div>
            <VBtn
              icon="i-lucide:trash-2"
              variant="text"
              size="small"
              class="shrink-0 text-muted"
              @click.stop="removeSkill(s.id)"
            />
          </div>
        </VCard>
      </div>

      <div v-if="!skills.length" class="flex flex-col items-center justify-center gap-2 py-10 text-faint select-none">
        <span class="i-lucide:wand-sparkles text-8" />
        <div class="text-sm">{{ t('settingsPage.skills.empty') }}</div>
      </div>
    </div>

    <!-- 内置技能详情弹窗 -->
    <VDialog v-model="detailOpen" max-width="560">
      <VCard v-if="detailSkill">
        <VCardTitle class="pr-16">
          <div class="flex items-center gap-2">
            <code class="rounded bg-elevated px-1.5 py-0.5 text-sm font-mono">{{ detailSkill.name }}</code>
            <span class="rounded border border-line px-1 py-0.5 text-[10px] font-medium leading-none text-muted">
              {{ t('settingsPage.skills.builtin') }}
            </span>
          </div>
        </VCardTitle>
        <VCardText>
          <div class="mb-3 text-sm text-fg">{{ detailSkill.description }}</div>
          <div
            class="max-h-72 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-elevated p-3 text-xs leading-5 text-fg"
          >
            {{ detailSkill.instructions }}
          </div>
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" @click="detailOpen = false">{{ t('dialog.close') }}</VBtn>
          <VBtn
            v-if="!addedBuiltinIds.has(detailSkill.id)"
            color="primary"
            prepend-icon="i-lucide:plus"
            @click="addBuiltin(detailSkill)"
          >
            {{ t('settingsPage.skills.addBuiltin') }}
          </VBtn>
          <VBtn v-else color="primary" prepend-icon="i-lucide:check" disabled>
            {{ t('settingsPage.skills.added') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <!-- 我的技能编辑弹窗 -->
    <VDialog v-model="dialogOpen" max-width="480">
      <VCard>
        <VCardTitle>{{ editingId ? t('settingsPage.skills.edit') : t('settingsPage.skills.add') }}</VCardTitle>
        <VCardText>
          <VTextField
            v-model="draft.name"
            :label="t('settingsPage.skills.name')"
            :placeholder="t('settingsPage.skills.namePlaceholder')"
            density="compact"
            variant="outlined"
            class="mb-3"
            hide-details
          />
          <VTextField
            v-model="draft.description"
            :label="t('settingsPage.skills.description')"
            density="compact"
            variant="outlined"
            class="mb-3"
            hide-details
          />
          <VTextarea
            v-model="draft.instructions"
            :label="t('settingsPage.skills.instructions')"
            density="compact"
            variant="outlined"
            rows="5"
            auto-grow
            hide-details
          />
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" @click="dialogOpen = false">{{ t('dialog.cancel') }}</VBtn>
          <VBtn color="primary" :disabled="!draft.name.trim() || !draft.instructions.trim()" @click="saveDraft">
            {{ t('settingsPage.save') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </div>
</template>
