<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ProviderConfig } from '@dscode/shared';
import { host } from '../../bridge/host';
import { useSettingsStore } from '../../stores/settings';

const { t } = useI18n();
const settingsStore = useSettingsStore();

// 本地可编辑副本：保存时一次性写回 settings，避免每个字段实时落盘
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

function toggleKey(id: string) {
  showKey.value[id] = !showKey.value[id];
}

function addModel(p: ProviderConfig) {
  const v = (newModel.value[p.id] ?? '').trim();
  if (!v || p.models.includes(v)) return;
  p.models.push(v);
  newModel.value[p.id] = '';
}

function removeModel(p: ProviderConfig, name: string) {
  p.models = p.models.filter(m => m !== name);
}

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

// ---- 自定义供应商：添加（验证并拉取模型）与删除 ----

const addOpen = ref(false);
const newName = ref('');
const newBaseUrl = ref('');
const newApiKey = ref('');
const verifying = ref(false);
/** 验证结果：'idle' | 'ok' | 失败原因 key；ok 时 fetchedModels 为拉取到的模型 */
const verifyState = ref<'idle' | 'ok' | 'unauthorized' | 'network' | 'invalid-args'>('idle');
const fetchedModels = ref<string[]>([]);

const addFormValid = computed(
  () => newName.value.trim().length > 0 && newBaseUrl.value.trim().length > 0 && newApiKey.value.trim().length > 0
);
/** 添加表单就绪：必填齐全且验证通过 */
const addReady = computed(() => addFormValid.value && verifyState.value === 'ok');
/** 验证失败原因 → i18n key（idle/ok 为空串） */
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

async function verifyNewProvider() {
  if (!host || !addFormValid.value) {
    verifyState.value = 'idle';
    return;
  }
  verifying.value = true;
  verifyState.value = 'idle';
  try {
    const r = await host.verifyProvider(newBaseUrl.value.trim(), newApiKey.value.trim());
    if (r.ok) {
      verifyState.value = 'ok';
      fetchedModels.value = r.models ?? [];
    } else {
      verifyState.value = r.reason;
      fetchedModels.value = [];
    }
  } finally {
    verifying.value = false;
  }
}

async function saveNewProvider() {
  if (!addReady.value) return;
  // 追加到现有列表（预置与自定义共存），验证时拉取到的模型自动填入
  providers.value.push({
    id: crypto.randomUUID(),
    name: newName.value.trim(),
    baseUrl: newBaseUrl.value.trim().replace(/\/+$/, ''),
    apiKey: newApiKey.value.trim(),
    models: [...fetchedModels.value]
  });
  await save();
  // 重置表单
  addOpen.value = false;
  newName.value = '';
  newBaseUrl.value = '';
  newApiKey.value = '';
  verifyState.value = 'idle';
  fetchedModels.value = [];
}

/** 删除供应商（含确认） */
const deleteTarget = ref<ProviderConfig | null>(null);
async function confirmDeleteProvider() {
  if (!deleteTarget.value) return;
  providers.value = providers.value.filter(p => p.id !== deleteTarget.value!.id);
  deleteTarget.value = null;
  await save();
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- 添加供应商（自定义 OpenAI 兼容接口：第三方中转 / OpenRouter / 本地 Ollama） -->
    <VCard class="px-4 py-3.5">
      <div class="flex items-center justify-between gap-6">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ t('settingsPage.model.addProvider') }}</div>
          <div class="mt-0.5 text-xs leading-5 text-muted">{{ t('settingsPage.model.addProviderHint') }}</div>
        </div>
        <VBtn size="small" variant="outlined" class="shrink-0" @click="addOpen = !addOpen">
          <span class="i-lucide:plus mr-1 text-3.5" />
          {{ t('settingsPage.model.addProvider') }}
        </VBtn>
      </div>

      <div v-if="addOpen" class="mt-3.5 border-t border-line pt-3.5">
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
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
            class="md:col-span-2"
          />
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <VBtn size="small" variant="outlined" :loading="verifying" :disabled="!addFormValid" @click="verifyNewProvider">
            <span class="i-lucide:plug-zap mr-1 text-3.5" />
            {{ t('settingsPage.model.verify') }}
          </VBtn>
          <VBtn size="small" color="primary" :disabled="!addReady" @click="saveNewProvider">
            {{ t('settingsPage.model.saveProvider') }}
          </VBtn>
          <!-- 验证结果反馈 -->
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
      </div>
    </VCard>

    <VCard v-for="p in providers" :key="p.id" class="px-4 py-3.5">
      <div class="flex items-center justify-between gap-6">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ p.name }}</div>
          <div class="mt-0.5 truncate text-xs leading-5 text-muted">{{ p.baseUrl }}</div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <VBtn size="small" icon variant="text" :title="t('settingsPage.model.deleteProvider')" @click="deleteTarget = p">
            <span class="i-lucide:trash-2 text-4" />
          </VBtn>
          <VBtn size="small" color="primary" class="shrink-0" @click="save">
            {{ t('settingsPage.save') }}
          </VBtn>
        </div>
      </div>

      <div class="mt-3.5 border-t border-line pt-3.5">
        <div class="mb-2 text-sm font-medium">{{ t('settingsPage.model.apiKey') }}</div>
        <VTextField
          v-model="p.apiKey"
          :type="showKey[p.id] ? 'text' : 'password'"
          :placeholder="t('onboarding.apiKeyPlaceholder')"
          :append-inner-icon="showKey[p.id] ? 'i-lucide:eye-off' : 'i-lucide:eye'"
          density="compact"
          variant="outlined"
          hide-details
          @click:append-inner="toggleKey(p.id)"
        />
      </div>

      <div class="mt-3.5 border-t border-line pt-3.5">
        <div class="mb-2 text-sm font-medium">{{ t('settingsPage.model.thinkingLabel') }}</div>
        <div class="text-xs leading-5 text-muted">{{ t('settingsPage.model.thinkingHint') }}</div>
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <VSelect
            v-model="thinkingSel[p.id]"
            :items="[
              { title: t('settingsPage.model.thinkingAuto'), value: 'auto' },
              { title: t('settingsPage.model.thinkingEnabled'), value: 'enabled' },
              { title: t('settingsPage.model.thinkingDisabled'), value: 'disabled' }
            ]"
            density="compact"
            variant="outlined"
            hide-details
            class="min-w-36 max-w-44"
          />
          <VSelect
            v-model="effortSel[p.id]"
            :items="[
              { title: t('settingsPage.model.effortAuto'), value: 'auto' },
              { title: t('settingsPage.model.effortOff'), value: 'off' },
              { title: t('settingsPage.model.effortHigh'), value: 'high' },
              { title: t('settingsPage.model.effortMax'), value: 'max' }
            ]"
            density="compact"
            variant="outlined"
            hide-details
            class="min-w-36 max-w-44"
          />
          <VTextField
            v-model="maxTokensSel[p.id]"
            type="number"
            density="compact"
            variant="outlined"
            hide-details
            :label="t('settingsPage.model.maxTokensLabel')"
            :hint="t('settingsPage.model.maxTokensHint')"
            persistent-hint
            class="max-w-56"
          />
          <VTextField
            v-model="contextWinSel[p.id]"
            type="number"
            density="compact"
            variant="outlined"
            hide-details
            :label="t('settingsPage.model.contextWindowLabel')"
            :hint="t('settingsPage.model.contextWindowHint')"
            persistent-hint
            class="max-w-56"
          />
        </div>
      </div>

      <div class="mt-3.5 border-t border-line pt-3.5">
        <div class="mb-2 text-sm font-medium">{{ t('settingsPage.model.models') }}</div>
        <div class="flex flex-wrap gap-2">
          <VChip v-for="m in p.models" :key="m" size="small" closable @click:close="removeModel(p, m)">
            {{ m }}
          </VChip>
        </div>
        <div class="mt-2 flex items-center gap-2">
          <VTextField
            v-model="newModel[p.id]"
            density="compact"
            variant="outlined"
            :placeholder="t('settingsPage.model.modelPlaceholder')"
            hide-details
            class="flex-1"
            @keydown.enter="addModel(p)"
          />
          <VBtn size="small" variant="outlined" class="shrink-0" @click="addModel(p)">
            {{ t('settingsPage.model.addModel') }}
          </VBtn>
        </div>
      </div>
    </VCard>

    <div v-if="!providers.length" class="flex flex-col items-center justify-center gap-2 py-16 text-faint select-none">
      <span class="i-lucide:server text-8" />
      <div class="text-sm">{{ t('settingsPage.model.empty') }}</div>
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
