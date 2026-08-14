<script setup lang="ts">
import { useUiStore } from '../../stores/ui';
import DiffPanel from './DiffPanel.vue';
import ResizeHandle from '../common/ResizeHandle.vue';

const ui = useUiStore();

/** 面板宽度限制（px） */
const RIGHT_MIN_WIDTH = 360;
const RIGHT_MAX_WIDTH = 720;
</script>

<template>
  <VNavigationDrawer
    v-model="ui.rightVisible"
    :permanent="ui.rightVisible"
    location="right"
    :width="ui.rightPanelWidth"
    class="border-l border-line"
  >
    <!-- 不加 relative：句柄定位上下文直接是抽屉根元素（position: fixed），细线才能与抽屉外缘边框重合 -->
    <!-- （避开 __content 的 overflow 裁剪） -->
    <div class="h-full">
      <!-- 左缘拖拽条：调整面板宽度 -->
      <ResizeHandle
        axis="x"
        :size="ui.rightPanelWidth"
        :min="RIGHT_MIN_WIDTH"
        :max="RIGHT_MAX_WIDTH"
        @resize="ui.setRightPanelWidth"
      />
      <DiffPanel />
    </div>
  </VNavigationDrawer>
</template>
