<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PermissionMode } from '@dscode/shared';
import { useSettingsStore } from '../../stores/settings';

/** 权限模式选择菜单；自 ChatInput 拆出 */

const { t } = useI18n();
const settingsStore = useSettingsStore();

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
  <VMenu v-model="permMenuOpen" location="top start" :offset="4">
    <template #activator="{ props: menuProps }">
      <VBtn
        v-bind="menuProps"
        :color="settingsStore.settings.permissionMode === 'full-access' ? 'warning' : ''"
        variant="text"
        size="small"
        class="px-2"
        :class="{ 'text-muted': settingsStore.settings.permissionMode !== 'full-access' }"
        :prepend-icon="PERMISSION_OPTIONS.find(item => item.value === settingsStore.settings.permissionMode)?.icon"
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
</template>
