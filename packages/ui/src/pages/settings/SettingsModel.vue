<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ProviderConfig } from '@dscode/shared';
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
</script>

<template>
  <div class="flex flex-col gap-4">
    <VCard v-for="p in providers" :key="p.id" class="px-4 py-3.5">
      <div class="flex items-center justify-between gap-6">
        <div class="min-w-0">
          <div class="text-sm font-medium">{{ p.name }}</div>
          <div class="mt-0.5 truncate text-xs leading-5 text-muted">{{ p.baseUrl }}</div>
        </div>
        <VBtn size="small" color="primary" class="shrink-0" @click="save">
          {{ t('settingsPage.save') }}
        </VBtn>
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
  </div>
</template>
