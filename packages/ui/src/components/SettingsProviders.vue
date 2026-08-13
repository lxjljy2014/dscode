<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ProviderConfig } from '@dscode/shared';
import { normalizeProviders, useSettingsStore } from '../stores/settings';
import ProviderEditor from './ProviderEditor.vue';

/**
 * 设置页「引导」版块：管理 AI 供应商配置（引导页的后续入口）。
 * 路由守卫保证进入设置页前 settings store 已加载完成。
 */

const { t } = useI18n();
const settingsStore = useSettingsStore();

// 编辑副本：保存时才写回 store（ProviderEditor 的更新是不可变的，可直接引用 store 数组）
const providers = ref<ProviderConfig[]>(settingsStore.settings.providers);

async function save() {
  await settingsStore.save({ providers: normalizeProviders(providers.value) });
}
</script>

<template>
  <div>
    <!-- 分组标签 -->
    <div class="mb-3">
      <span class="rounded-md bg-elevated px-2 py-1 text-xs text-muted">
        {{ t('onboarding.providers') }}
      </span>
    </div>

    <ProviderEditor v-model="providers" />

    <div class="mt-4 flex justify-end">
      <VBtn size="small" color="primary" @click="save">{{ t('settingsPage.save') }}</VBtn>
    </div>
  </div>
</template>
