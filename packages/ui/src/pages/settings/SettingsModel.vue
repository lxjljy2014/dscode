<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ProviderConfig } from '@dscode/shared';
import { PROVIDER_PRESETS } from '@dscode/shared';
import { host } from '../../bridge/host';
import { useSettingsStore } from '../../stores/settings';
import { useAgentStore } from '../../stores/agent';

/**
 * 模型设置：左栏供应商导航（VList nav）+ 右栏编辑/添加，全部交互走 Vuetify
 * 组件（VListItem / VItemGroup + VCard），不再用裸 button 手搓样式。
 * 视觉签名是 monogram 徽标——厂商名首个拉丁词前两字符的等宽字方块
 * （纯中文名取首字），左栏列表、右栏头部、预设网格三处复用。
 * 本地可编辑副本 + 保存按钮一次性写回（与其它设置页一致）。
 */

const { t } = useI18n();
const settingsStore = useSettingsStore();
const agentStore = useAgentStore();

const providers = ref<ProviderConfig[]>([]);
const showKey = ref<Record<string, boolean>>({});
const newModel = ref<Record<string, string>>({});
// 推理/输出本地编辑态（select 用字符串表达三态，保存时映射回 boolean/undefined）
const thinkingSel = ref<Record<string, string>>({});
const effortSel = ref<Record<string, string>>({});
const maxTokensSel = ref<Record<string, string>>({});
const contextWinSel = ref<Record<string, string>>({});

watch(
  () => settingsStore.settings.providers,
  list => {
    providers.value = list.map(p => ({ ...p, models: [...p.models] }));
    for (const p of list) {
      thinkingSel.value[p.id] = p.thinking === undefined ? 'auto' : p.thinking ? 'enabled' : 'disabled';
      effortSel.value[p.id] = p.reasoningEffort ?? 'auto';
      maxTokensSel.value[p.id] = p.maxTokens !== undefined ? String(p.maxTokens) : '';
      contextWinSel.value[p.id] = p.contextWindow !== undefined ? String(p.contextWindow) : '';
    }
  },
  { immediate: true, deep: true }
);

// ---- 左右栏选中态（'__add__' = 添加视图） ----

const ADD_KEY = '__add__';
const selectedId = ref<string | null>(null);
// 选中项失效（被删/初始）时回退到第一项
watch(
  providers,
  list => {
    if (selectedId.value !== ADD_KEY && !list.some(p => p.id === selectedId.value)) {
      selectedId.value = list[0]?.id ?? null;
    }
  },
  { immediate: true }
);
const selected = computed(() => providers.value.find(p => p.id === selectedId.value) ?? null);
const isAdding = computed(() => selectedId.value === ADD_KEY);
/** 当前在用模型所属的供应商（左栏绿点：一眼看出正在用的是哪家） */
const activeProviderId = computed(() => {
  const m = agentStore.activeModel;
  if (!m) return null;
  return providers.value.find(p => p.models.includes(m))?.id ?? null;
});

function select(id: string) {
  // 离开添加视图时清掉验证状态
  if (id !== ADD_KEY) resetVerify();
  selectedId.value = id;
}

function toggleKey(id: string) {
  showKey.value[id] = !showKey.value[id];
}

/** 厂商 monogram：取名称中首个拉丁词前两字符（纯中文名取首字），避免双汉字挤占方块 */
function monogram(name: string): string {
  const trimmed = name.trim();
  const latin = trimmed.match(/[A-Za-z][A-Za-z0-9]*/);
  if (latin) return latin[0].slice(0, 2).toUpperCase();
  const cjk = trimmed.match(/[\u4e00-\u9fff]/);
  return cjk ? cjk[0] : '?';
}

// ---- 保存 / 删除 ----

async function save() {
  await settingsStore.save({
    providers: providers.value.map(p => {
      const next: ProviderConfig = { ...p, models: [...p.models], apiKey: p.apiKey.trim() };
      const th = thinkingSel.value[p.id];
      if (th === 'enabled') next.thinking = true;
      else if (th === 'disabled') next.thinking = false;
      else delete next.thinking;
      const e = effortSel.value[p.id];
      if (e === 'off' || e === 'high' || e === 'max') next.reasoningEffort = e;
      else delete next.reasoningEffort;
      const mt = (maxTokensSel.value[p.id] ?? '').trim();
      if (mt !== '' && Number(mt) > 0) next.maxTokens = Number(mt);
      else delete next.maxTokens;
      const cw = (contextWinSel.value[p.id] ?? '').trim();
      if (cw !== '' && Number(cw) > 0) next.contextWindow = Number(cw);
      else delete next.contextWindow;
      return next;
    })
  });
}

const deleteTarget = ref<ProviderConfig | null>(null);
async function confirmDeleteProvider() {
  if (!deleteTarget.value) return;
  const removed = deleteTarget.value;
  providers.value = providers.value.filter(p => p.id !== removed.id);
  deleteTarget.value = null;
  await save();
}

// ---- 模型增删（编辑态） ----

function addModel(p: ProviderConfig) {
  const v = (newModel.value[p.id] ?? '').trim();
  if (!v || p.models.includes(v)) return;
  p.models.push(v);
  newModel.value[p.id] = '';
}

function removeModel(p: ProviderConfig, name: string) {
  p.models = p.models.filter(m => m !== name);
}

// ---- 验证与模型拉取（添加表单与编辑态共用） ----

const verifying = ref(false);
const verifyState = ref<'idle' | 'ok' | 'unauthorized' | 'network' | 'invalid-args'>('idle');
const fetchedModels = ref<string[]>([]);
/** 编辑态「重新拉取」时记录目标供应商（成功后填入其本地副本） */
const fetchTargetId = ref<string | null>(null);

const verifyErrorKey = computed(() => {
  switch (verifyState.value) {
    case 'unauthorized':
      return 'settingsPage.model.verifyUnauthorized';
    case 'network':
      return 'settingsPage.model.verifyNetwork';
    case 'invalid-args':
      return 'settingsPage.model.verifyInvalid';
    default:
      return '';
  }
});

function resetVerify() {
  verifyState.value = 'idle';
  fetchedModels.value = [];
  fetchTargetId.value = null;
}

async function verifyAndFetch(baseUrl: string, apiKey: string, targetId: string | null) {
  if (!host) return;
  verifying.value = true;
  resetVerify();
  fetchTargetId.value = targetId;
  try {
    const r = await host.verifyProvider(baseUrl.trim(), apiKey.trim());
    if (r.ok) {
      verifyState.value = 'ok';
      fetchedModels.value = r.models ?? [];
    } else {
      verifyState.value = r.reason;
    }
  } finally {
    verifying.value = false;
  }
}

/** 验证成功后把拉取到的模型并入目标供应商（编辑态：合并去重；拉空则不动） */
function applyFetchedModels() {
  const target = fetchTargetId.value ? providers.value.find(p => p.id === fetchTargetId.value) : null;
  if (!target || fetchedModels.value.length === 0) return;
  const set = new Set(target.models);
  for (const m of fetchedModels.value) set.add(m);
  target.models = [...set];
}

// ---- 添加供应商（预设点选填表） ----

const newName = ref('');
const newBaseUrl = ref('');
const newApiKey = ref('');

const addFormValid = computed(
  () => newName.value.trim().length > 0 && newBaseUrl.value.trim().length > 0 && newApiKey.value.trim().length > 0
);
const addReady = computed(() => addFormValid.value && verifyState.value === 'ok');

/** 预设选中态：按表单当前值反查（手动改动名称/地址即视为自定义，自动取消选中） */
const pickedPresetId = computed<string | undefined>({
  get: () =>
    PROVIDER_PRESETS.find(p => p.name === newName.value.trim() && p.baseUrl === newBaseUrl.value.trim())?.id,
  set: id => {
    const preset = PROVIDER_PRESETS.find(p => p.id === id);
    if (!preset) return;
    newName.value = preset.name;
    newBaseUrl.value = preset.baseUrl;
    resetVerify();
  }
});

async function saveNewProvider() {
  if (!addReady.value) return;
  const created: ProviderConfig = {
    id: crypto.randomUUID(),
    name: newName.value.trim(),
    baseUrl: newBaseUrl.value.trim().replace(/\/+$/, ''),
    apiKey: newApiKey.value.trim(),
    models: [...fetchedModels.value]
  };
  providers.value.push(created);
  await save();
  // 跳到新供应商的编辑视图
  selectedId.value = created.id;
  newName.value = '';
  newBaseUrl.value = '';
  newApiKey.value = '';
  resetVerify();
}
</script>

<template>
  <div class="-mt-1 flex items-stretch gap-6">
    <!-- 左栏：供应商导航（VList nav，选中 = Vuetify 主色 pill） -->
    <nav class="sticky top-0 w-60 shrink-0 self-start border-r border-line pr-2" aria-label="providers">
      <VList class="p-0" nav density="compact">
        <VListItem
          v-for="p in providers"
          :key="p.id"
          class="mb-0.5"
          @click="select(p.id)"
        >
          <template #prepend>
            <span
              class="mr-1 flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md font-mono text-3 font-semibold tracking-tight"
              :class="p.id === selectedId ? 'bg-primary/15 text-primary' : 'bg-elevated text-muted'"
            >
              {{ monogram(p.name) }}
            </span>
          </template>
          <VListItemTitle class="text-sm" :class="p.id === selectedId ? 'font-semibold text-primary' : ''">
            {{ p.name }}
          </VListItemTitle>
          <VListItemSubtitle class="text-xs">
            {{ p.apiKey ? t('settingsPage.model.modelsCount', { n: p.models.length }) : t('settingsPage.model.keyNotSet') }}
          </VListItemSubtitle>
          <template #append>
            <span
              v-if="p.id === activeProviderId"
              class="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-success"
              :title="t('settingsPage.model.inUse')"
            />
          </template>
        </VListItem>

        <VDivider class="my-1.5" />

        <VListItem class="text-muted" @click="select(ADD_KEY)">
          <template #prepend>
            <span class="i-lucide:plus mr-2 h-6.5 w-6.5 shrink-0 rounded-md bg-elevated p-1.5 text-4" />
          </template>
          <VListItemTitle class="text-sm" :class="isAdding ? 'font-semibold text-primary' : ''">
            {{ t('settingsPage.model.addProvider') }}
          </VListItemTitle>
        </VListItem>
      </VList>
    </nav>

    <!-- 右栏 -->
    <div class="min-w-0 flex-1 py-1">
      <!-- 编辑视图 -->
      <template v-if="selected">
        <!-- 头部：身份（大字名称可编辑）+ 保存锚点 -->
        <div class="flex items-start gap-4">
          <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-elevated font-mono text-5 font-semibold text-muted">
            {{ monogram(selected.name) }}
          </span>
          <div class="group min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <VTextField
                v-model="selected.name"
                density="compact"
                variant="plain"
                hide-details
                class="text-lg font-semibold"
                :placeholder="t('settingsPage.model.providerNamePlaceholder')"
              />
              <span class="i-lucide:pencil mb-0.5 text-3.5 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <div class="mt-1 flex items-center gap-2 text-xs leading-5 text-muted">
              <span class="h-1.5 w-1.5 rounded-full" :class="selected.apiKey ? 'bg-success' : 'bg-warning'" />
              {{ selected.apiKey ? t('settingsPage.model.keySet') : t('settingsPage.model.keyNotSet') }}
              <span class="text-faint">·</span>
              <span>{{ t('settingsPage.model.modelsCount', { n: selected.models.length }) }}</span>
            </div>
          </div>
          <VBtn size="small" color="primary" class="mt-1.5" @click="save">
            {{ t('settingsPage.save') }}
          </VBtn>
        </div>

        <!-- 连接：关键字段独占一行，outlined 带标签 -->
        <section class="mt-7">
          <h3 class="text-xs font-medium text-faint">{{ t('settingsPage.model.sectionConnect') }}</h3>
          <div class="mt-2 flex flex-col gap-3">
            <VTextField
              v-model="selected.baseUrl"
              density="compact"
              variant="outlined"
              hide-details
              :label="t('settingsPage.model.providerBaseUrl')"
              :placeholder="t('settingsPage.model.providerBaseUrlPlaceholder')"
            />
            <VTextField
              v-model="selected.apiKey"
              :type="showKey[selected.id] ? 'text' : 'password'"
              density="compact"
              variant="outlined"
              hide-details
              :label="t('settingsPage.model.apiKey')"
              :placeholder="t('onboarding.apiKeyPlaceholder')"
              :append-inner-icon="showKey[selected.id] ? 'i-lucide:eye-off' : 'i-lucide:eye'"
              @click:append-inner="toggleKey(selected.id)"
            />
          </div>
        </section>

        <!-- 模型列表 -->
        <section class="mt-6">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-medium text-faint">{{ t('settingsPage.model.models') }}</h3>
            <VBtn
              size="small"
              variant="text"
              color="primary"
              :loading="verifying && fetchTargetId === selected.id"
              :disabled="!selected.baseUrl.trim() || !selected.apiKey.trim()"
              @click="verifyAndFetch(selected.baseUrl, selected.apiKey, selected.id)"
            >
              <span class="i-lucide:refresh-cw mr-1 text-3.5" />
              {{ t('settingsPage.model.fetchModels') }}
            </VBtn>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <VChip v-for="m in selected.models" :key="m" size="small" variant="tonal" closable @click:close="removeModel(selected, m)">
              {{ m }}
            </VChip>
          </div>
          <div class="mt-1 flex items-center gap-2">
            <VTextField
              v-model="newModel[selected.id]"
              density="compact"
              variant="outlined"
              :label="t('settingsPage.model.modelLabel')"
              :placeholder="t('settingsPage.model.modelPlaceholder')"
              hide-details
              class="flex-1"
              @keydown.enter="addModel(selected)"
            />
            <VBtn size="small" variant="text" class="shrink-0" @click="addModel(selected)">
              {{ t('settingsPage.model.addModel') }}
            </VBtn>
          </div>
          <!-- 拉取结果反馈（编辑态：点应用后合并进 chips） -->
          <div
            v-if="fetchTargetId === selected.id && verifyState === 'ok' && fetchedModels.length > 0"
            class="mt-2 flex flex-wrap items-center gap-2"
          >
            <span class="text-xs text-success">
              <span class="i-lucide:circle-check mr-1" />
              {{ t('settingsPage.model.fetchModelsOk', { n: fetchedModels.length }) }}
            </span>
            <VBtn size="x-small" variant="tonal" @click="applyFetchedModels">
              {{ t('settingsPage.model.verify') }}
            </VBtn>
          </div>
          <div v-else-if="fetchTargetId === selected.id && verifyErrorKey" class="mt-2 text-xs text-error">
            <span class="i-lucide:circle-x mr-1" />
            {{ t(verifyErrorKey) }}
          </div>
        </section>

        <!-- 推理与输出：标签 + 说明 + 控件的行结构 -->
        <section class="mt-6">
          <h3 class="text-xs font-medium text-faint">{{ t('settingsPage.model.sectionReasoning') }}</h3>
          <div class="divide-y divide-line">
            <div class="grid grid-cols-[11rem_1fr] items-center gap-6 py-2.5">
              <div>
                <div class="text-sm">{{ t('settingsPage.model.thinkingLabel') }}</div>
                <div class="mt-0.5 text-xs leading-4 text-muted">{{ t('settingsPage.model.thinkingHint') }}</div>
              </div>
              <VSelect
                v-model="thinkingSel[selected.id]"
                :items="[
                  { title: t('settingsPage.model.thinkingAuto'), value: 'auto' },
                  { title: t('settingsPage.model.thinkingEnabled'), value: 'enabled' },
                  { title: t('settingsPage.model.thinkingDisabled'), value: 'disabled' }
                ]"
                density="compact"
                variant="outlined"
                hide-details
              />
            </div>
            <div class="grid grid-cols-[11rem_1fr] items-center gap-6 py-2.5">
              <div class="text-sm">{{ t('settingsPage.model.effortLabel') }}</div>
              <VSelect
                v-model="effortSel[selected.id]"
                :items="[
                  { title: t('settingsPage.model.effortAuto'), value: 'auto' },
                  { title: t('settingsPage.model.effortOff'), value: 'off' },
                  { title: t('settingsPage.model.effortHigh'), value: 'high' },
                  { title: t('settingsPage.model.effortMax'), value: 'max' }
                ]"
                density="compact"
                variant="outlined"
                hide-details
              />
            </div>
            <div class="grid grid-cols-[11rem_1fr] items-center gap-6 py-2.5">
              <div>
                <div class="text-sm">{{ t('settingsPage.model.maxTokensLabel') }}</div>
                <div class="mt-0.5 text-xs leading-4 text-muted">{{ t('settingsPage.model.maxTokensHint') }}</div>
              </div>
              <VTextField v-model="maxTokensSel[selected.id]" type="number" density="compact" variant="outlined" hide-details />
            </div>
            <div class="grid grid-cols-[11rem_1fr] items-center gap-6 py-2.5">
              <div>
                <div class="text-sm">{{ t('settingsPage.model.contextWindowLabel') }}</div>
                <div class="mt-0.5 text-xs leading-4 text-muted">{{ t('settingsPage.model.contextWindowHint') }}</div>
              </div>
              <VTextField v-model="contextWinSel[selected.id]" type="number" density="compact" variant="outlined" hide-details />
            </div>
          </div>
        </section>

        <!-- 底部：破坏性操作沉底，远离保存 -->
        <div class="mt-8 flex justify-end border-t border-line pt-3">
          <VBtn variant="text" size="small" color="error" @click="deleteTarget = selected">
            <span class="i-lucide:trash-2 mr-1 text-3.5" />
            {{ t('settingsPage.model.deleteProvider') }}
          </VBtn>
        </div>
      </template>

      <!-- 添加视图：预设 + 表单 -->
      <template v-else-if="isAdding">
        <div class="border-b border-line pb-4">
          <div class="text-sm font-medium">{{ t('settingsPage.model.addProvider') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">{{ t('settingsPage.model.presetsSection') }}</div>
        </div>

        <!-- 预设厂商：安静的无边框选择卡；选中 = 主色细描边 + 微底色 + 勾选 -->
        <VItemGroup v-model="pickedPresetId" class="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
          <VItem v-for="preset in PROVIDER_PRESETS" :key="preset.id" v-slot="{ isSelected, toggle }" :value="preset.id">
            <VCard
              variant="flat"
              link
              class="h-full transition-colors"
              :class="isSelected ? 'bg-primary/10 ring-1 ring-primary' : 'bg-elevated/60 hover:bg-elevated'"
              @click="toggle"
            >
              <div class="flex items-center gap-2.5 p-3">
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-3 font-semibold"
                  :class="isSelected ? 'bg-primary/15 text-primary' : 'text-muted'"
                >
                  {{ monogram(preset.name) }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm leading-5 text-fg">{{ preset.name }}</span>
                  <span class="block truncate font-mono text-xs leading-4 text-muted">{{ preset.baseUrl }}</span>
                </span>
                <span v-if="isSelected" class="i-lucide:circle-check shrink-0 text-4.5 text-primary" />
              </div>
            </VCard>
          </VItem>
        </VItemGroup>

        <!-- 自定义表单 -->
        <section class="mt-6">
          <h3 class="text-xs font-medium text-faint">{{ t('settingsPage.model.customPreset') }}</h3>
          <div class="mt-2 flex flex-col gap-3">
            <VTextField
              v-model="newName"
              density="compact"
              variant="outlined"
              hide-details
              :label="t('settingsPage.model.providerName')"
              :placeholder="t('settingsPage.model.providerNamePlaceholder')"
            />
            <VTextField
              v-model="newBaseUrl"
              density="compact"
              variant="outlined"
              hide-details
              :label="t('settingsPage.model.providerBaseUrl')"
              :placeholder="t('settingsPage.model.providerBaseUrlPlaceholder')"
            />
            <VTextField
              v-model="newApiKey"
              type="password"
              density="compact"
              variant="outlined"
              hide-details
              :label="t('settingsPage.model.apiKey')"
              :placeholder="t('onboarding.apiKeyPlaceholder')"
            />
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-3">
            <VBtn size="small" variant="outlined" :loading="verifying" :disabled="!addFormValid" @click="verifyAndFetch(newBaseUrl, newApiKey, null)">
              <span class="i-lucide:plug-zap mr-1 text-3.5" />
              {{ t('settingsPage.model.verify') }}
            </VBtn>
            <VBtn size="small" color="primary" :disabled="!addReady" @click="saveNewProvider">
              {{ t('settingsPage.model.saveProvider') }}
            </VBtn>
            <span v-if="verifyState === 'ok'" class="text-xs text-success">
              <span class="i-lucide:circle-check mr-1" />
              {{
                fetchedModels.length > 0
                  ? t('settingsPage.model.verifyOkWithModels', { n: fetchedModels.length })
                  : t('settingsPage.model.verifyOk')
              }}
            </span>
            <span v-else-if="verifyErrorKey" class="text-xs text-error">
              <span class="i-lucide:circle-x mr-1" />
              {{ t(verifyErrorKey) }}
            </span>
            <span v-else-if="!addFormValid" class="text-xs text-faint">
              {{ t('settingsPage.model.verifyFirst') }}
            </span>
          </div>
          <div v-if="verifyState === 'ok'" class="mt-2 text-xs text-muted">
            {{ t('settingsPage.model.providerModelsHint') }}
          </div>
        </section>
      </template>

      <!-- 无供应商且未点添加 -->
      <div v-else class="flex flex-col items-center justify-center gap-2 py-16 text-faint select-none">
        <span class="i-lucide:server text-8" />
        <div class="text-sm">{{ t('settingsPage.model.empty') }}</div>
        <div class="text-xs">{{ t('settingsPage.model.emptyHint') }}</div>
      </div>
    </div>

    <!-- 删除供应商确认 -->
    <VDialog :model-value="deleteTarget !== null" max-width="420" @update:model-value="v => { if (!v) deleteTarget = null }">
      <VCard>
        <VCardTitle class="text-sm">
          {{ t('settingsPage.model.deleteProvider') }}
        </VCardTitle>
        <VCardText class="text-xs leading-5 text-muted">
          {{ t('settingsPage.model.deleteProviderConfirm', { name: deleteTarget?.name ?? '' }) }}
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" size="small" @click="deleteTarget = null">
            {{ t('dialog.cancel') }}
          </VBtn>
          <VBtn color="error" variant="flat" size="small" @click="confirmDeleteProvider">
            {{ t('settingsPage.model.deleteProvider') }}
          </VBtn>
        </VCardActions>
      </VCard>
    </VDialog>
  </div>
</template>
