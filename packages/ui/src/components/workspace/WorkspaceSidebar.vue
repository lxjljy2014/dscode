<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { isFrameless, isMac } from '../../bridge/host';
import { useSessionStore } from '../../stores/session';
import { useUiStore } from '../../stores/ui';
import SessionSidebar from './SessionSidebar.vue';

const { t } = useI18n();
const store = useSessionStore();
const ui = useUiStore();
const { keyword } = storeToRefs(store);

// 搜索：默认收起，⌘K 或导航项展开
const searchVisible = ref(false);
const searchRef = ref<{ focus: () => void } | null>(null);

async function toggleSearch() {
  searchVisible.value = !searchVisible.value;
  if (searchVisible.value) {
    await nextTick();
    searchRef.value?.focus();
  } else {
    keyword.value = '';
  }
}

const modKey = isMac ? '⌘' : 'Ctrl';

function onGlobalKeydown(e: KeyboardEvent) {
  // 输入场景（含 IME 组合态）不拦截，避免打断打字
  if (e.isComposing) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, [contenteditable]')) return;
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === 'n') {
    e.preventDefault();
    store.createSession();
  } else if (e.key === 'k') {
    e.preventDefault();
    if (!searchVisible.value) toggleSearch();
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKeydown));
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶栏：macOS 让位红绿灯；侧栏切换 + 前进/后退（暂无历史，禁用占位） -->
    <div
      class="h-12 shrink-0 flex items-center gap-0.5 pr-2"
      :class="[isFrameless ? 'ds-drag' : '', isMac ? 'pl-[84px]' : 'pl-2']"
    >
      <VIconBtn
        v-tooltip="{
          text: t('settings.toggleLeft'),
          location: 'bottom'
        }"
        icon="i-lucide:panel-left-close"
        variant="text"
        size="small"
        class="text-muted"
        @click="ui.toggleLeft()"
      />
    </div>

    <!-- 主导航 -->
    <VList class="shrink-0 px-2 pt-2" nav>
      <VListItem prepend-icon="i-lucide:circle-plus" @click="store.createSession()">
        <VListItemTitle class="text-sm">{{ t('nav.newTask') }}</VListItemTitle>
        <template #append>
          <span class="text-xs text-faint">{{ modKey }} N</span>
        </template>
      </VListItem>
      <VListItem prepend-icon="i-lucide:search" :active="searchVisible" @click="toggleSearch()">
        <VListItemTitle class="text-sm">{{ t('nav.search') }}</VListItemTitle>
        <template #append>
          <span class="text-xs text-faint">{{ modKey }} K</span>
        </template>
      </VListItem>
      <VListItem prepend-icon="i-lucide:bot">
        <VListItemTitle class="text-sm">{{ t('nav.automation') }}</VListItemTitle>
      </VListItem>
      <VListItem prepend-icon="i-lucide:wand-sparkles">
        <VListItemTitle class="text-sm">{{ t('nav.skills') }}</VListItemTitle>
      </VListItem>
    </VList>

    <!-- 展开的搜索框 -->
    <div v-if="searchVisible" class="shrink-0 px-3 pb-1 pt-2">
      <VTextField
        ref="searchRef"
        v-model="keyword"
        density="compact"
        prepend-inner-icon="i-lucide:search"
        :placeholder="t('session.search')"
        clearable
      />
    </div>

    <!-- 项目 + 会话列表 -->
    <SessionSidebar />
  </div>
</template>
