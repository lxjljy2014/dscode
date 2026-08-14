<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useSessionStore } from '../../stores/session';
import SessionSidebar from './SessionSidebar.vue';

const store = useSessionStore();
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
    <!-- 项目 + 会话列表 -->
    <SessionSidebar />
  </div>
</template>
