<script setup lang="ts">
import { reactive } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ProviderConfig } from '@dscode/shared';

/**
 * AI 供应商配置编辑器（引导页与设置页复用）。
 * 只负责编辑 v-model 的 providers 列表，持久化由父组件负责。
 */

const props = defineProps<{ modelValue: ProviderConfig[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: ProviderConfig[]] }>();

const { t } = useI18n();

// 每家供应商的 apiKey 可见性与模型草稿输入（按 id 存，避免把草稿混进 modelValue）
const keyVisible = reactive<Record<string, boolean>>({});
const modelDrafts = reactive<Record<string, string>>({});

function update(provider: ProviderConfig, patch: Partial<ProviderConfig>) {
  emit(
    'update:modelValue',
    props.modelValue.map(p => (p.id === provider.id ? { ...p, ...patch } : p))
  );
}

function removeProvider(id: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter(p => p.id !== id)
  );
}

function addProvider() {
  emit('update:modelValue', [
    ...props.modelValue,
    { id: crypto.randomUUID(), name: '', baseUrl: '', apiKey: '', models: [] }
  ]);
}

function addModel(provider: ProviderConfig) {
  const draft = (modelDrafts[provider.id] ?? '').trim();
  if (!draft) return;
  update(provider, { models: [...provider.models, draft] });
  modelDrafts[provider.id] = '';
}

function removeModel(provider: ProviderConfig, model: string) {
  update(provider, { models: provider.models.filter(m => m !== model) });
}

function toggleKeyVisible(id: string) {
  keyVisible[id] = !keyVisible[id];
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <VCard v-for="provider in modelValue" :key="provider.id" class="px-4 py-3.5">
      <!-- 名称 + 删除 -->
      <div class="flex items-center gap-2">
        <VTextField
          :model-value="provider.name"
          :label="t('onboarding.providerName')"
          :placeholder="t('onboarding.providerNamePlaceholder')"
          density="compact"
          hide-details
          class="flex-1"
          @update:model-value="update(provider, { name: $event })"
        />
        <VBtn
          icon="i-lucide:trash-2"
          variant="text"
          size="small"
          color="error"
          class="shrink-0 text-muted"
          :title="t('onboarding.deleteProvider')"
          @click="removeProvider(provider.id)"
        />
      </div>

      <!-- API key -->
      <div class="mt-3">
        <VTextField
          :model-value="provider.apiKey"
          :type="keyVisible[provider.id] ? 'text' : 'password'"
          :label="t('onboarding.apiKey')"
          :placeholder="t('onboarding.apiKeyPlaceholder')"
          :append-inner-icon="keyVisible[provider.id] ? 'i-lucide:eye-off' : 'i-lucide:eye'"
          density="compact"
          hide-details
          @update:model-value="update(provider, { apiKey: $event })"
          @click:append-inner="toggleKeyVisible(provider.id)"
        />
      </div>

      <!-- 接口地址 -->
      <div class="mt-3">
        <VTextField
          :model-value="provider.baseUrl"
          :label="t('onboarding.baseUrl')"
          placeholder="https://api.example.com"
          density="compact"
          hide-details
          @update:model-value="update(provider, { baseUrl: $event })"
        />
      </div>

      <!-- 模型列表 -->
      <div class="mt-3 border-t border-line pt-3">
        <div class="text-xs font-medium text-muted">{{ t('onboarding.models') }}</div>
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <VChip
            v-for="model in provider.models"
            :key="model"
            size="small"
            closable
            class="bg-elevated"
            @click:close="removeModel(provider, model)"
          >
            {{ model }}
          </VChip>
          <VTextField
            :model-value="modelDrafts[provider.id] ?? ''"
            density="compact"
            hide-details
            class="w-52"
            :placeholder="t('onboarding.modelPlaceholder')"
            @update:model-value="modelDrafts[provider.id] = $event"
            @keydown.enter.prevent="addModel(provider)"
          />
        </div>
      </div>
    </VCard>

    <!-- 添加供应商 -->
    <VBtn
      variant="outlined"
      size="small"
      prepend-icon="i-lucide:plus"
      class="self-start"
      @click="addProvider"
    >
      {{ t('onboarding.addProvider') }}
    </VBtn>
  </div>
</template>
