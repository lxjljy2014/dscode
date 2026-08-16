<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import type { UpdaterState } from '@dscode/shared';
import { host } from '../../bridge/host';

const router = useRouter();
const { t } = useI18n();

// 自动更新状态（主进程推送）
const updaterState = ref<UpdaterState>({ state: 'idle' });
let unsubscribe: (() => void) | null = null;

const state = computed(() => updaterState.value.state);
const version = computed(() => {
  const s = updaterState.value;
  return s.state === 'available' || s.state === 'downloading' || s.state === 'downloaded' ? s.version : '';
});
const percent = computed(() => (updaterState.value.state === 'downloading' ? updaterState.value.percent : 0));

async function download(): Promise<void> {
  await host?.updaterDownload();
}
async function install(): Promise<void> {
  await host?.updaterInstall();
}

onMounted(() => {
  if (!host?.onUpdaterState) return;
  unsubscribe = host.onUpdaterState(s => {
    updaterState.value = s;
  });
  // 拉取当前状态（窗口重载后仍能同步）
  void host.updaterGetState().then(s => {
    updaterState.value = s;
  });
});
onBeforeUnmount(() => unsubscribe?.());
</script>

<template>
  <!-- 底部用户栏：两个路由的左侧栏共用 -->
  <div class="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
    <VAvatar size="26" color="primary">
      <span class="text-xs font-medium text-on-primary">D</span>
    </VAvatar>
    <span class="truncate text-sm">developer</span>
    <VSpacer />
    <VBtn icon="i-lucide:app-window" variant="text" size="x-small" class="text-muted" />

    <!-- 自动更新按钮：有新版→更新；下载中→环形进度（不可点）；下载完成→重启更新 -->
    <VTooltip v-if="state === 'available'" :text="t('updater.available', { version })" location="top">
      <template #activator="{ props }">
        <VBtn
          v-bind="props"
          icon="i-lucide:download"
          variant="text"
          size="x-small"
          class="text-muted"
          @click="download()"
        />
      </template>
    </VTooltip>
    <VTooltip v-else-if="state === 'downloading'" :text="t('updater.downloading', { percent })" location="top">
      <template #activator="{ props }">
        <VProgressCircular
          v-bind="props"
          :model-value="percent"
          :size="20"
          :width="3"
          color="primary"
          class="mx-0.5 shrink-0"
        />
      </template>
    </VTooltip>
    <VTooltip v-else-if="state === 'downloaded'" :text="t('updater.downloaded')" location="top">
      <template #activator="{ props }">
        <VBtn
          v-bind="props"
          icon="i-lucide:refresh-cw"
          variant="text"
          size="x-small"
          class="text-primary"
          @click="install()"
        />
      </template>
    </VTooltip>

    <VBtn
      icon="i-lucide:settings"
      variant="text"
      size="x-small"
      class="text-muted"
      @click="router.push('/settings').catch(() => {})"
    />
  </div>
</template>
