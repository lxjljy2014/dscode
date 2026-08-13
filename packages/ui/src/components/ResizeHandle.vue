<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  /** 拖拽轴：'x' 左右拖（调整宽度）| 'y' 上下拖（调整高度） */
  axis: 'x' | 'y';
  /** 当前尺寸（px），拖动起点以此为基准 */
  size: number;
  min: number;
  max: number;
}>();

const emit = defineEmits<{ resize: [size: number] }>();

const dragging = ref(false);
let startCoord = 0;
let startSize = 0;
let effectiveMax = 0;
// rAF 合并高频 pointermove：每帧最多 emit 一次，避免拖动时一帧内多次全页 reflow 造成卡顿
let rafId = 0;
let pendingSize: number | null = null;

function coord(e: PointerEvent): number {
  return props.axis === 'x' ? e.clientX : e.clientY;
}

function viewport(): number {
  return props.axis === 'x' ? window.innerWidth : window.innerHeight;
}

function clampSize(e: PointerEvent): number {
  // 向左 / 向上拖（当前坐标 < 起始坐标）→ 尺寸增大
  return Math.min(Math.max(startSize + (startCoord - coord(e)), props.min), effectiveMax);
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  dragging.value = true;
  startCoord = coord(e);
  startSize = props.size;
  // 拖拽时给视口留白，防止面板占满窗口
  effectiveMax = Math.max(props.min, Math.min(props.max, viewport() - 80));
  // 拖拽期间关闭 VMain 的布局 padding 过渡（global.css 中 .ds-resizing 规则），让主区即时跟随
  document.body.classList.add('ds-resizing');
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging.value) return;
  pendingSize = clampSize(e);
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    if (pendingSize !== null) {
      emit('resize', pendingSize);
      pendingSize = null;
    }
  });
}

function onPointerUp(e: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  // 取消尚未落帧的更新，直接落定最终位置，保证松开时尺寸精确
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (pendingSize !== null) {
    emit('resize', pendingSize);
    pendingSize = null;
  }
  document.body.classList.remove('ds-resizing');
  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
}
</script>

<template>
  <!-- 遮罩式拖拽条：不占布局，贴面板外缘；pointer capture 保证拖出区域也不丢事件 -->
  <!-- group 为静态容器：命中区/细线直接锚定抽屉根元素（containing block），可越过 __content 的 overflow 裁剪 -->
  <div class="group">
    <!-- 4px 命中区（-1px 让出边框位置） -->
    <div
      class="absolute z-10 select-none touch-none"
      :class="[axis === 'x' ? 'inset-y-0 -left-[1px] w-1 cursor-ew-resize' : 'inset-x-0 -top-[1px] h-1 cursor-ns-resize']"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />
    <!-- 高亮细线（2px）：覆盖抽屉外缘 1px 边框，与其重合 -->
    <div
      class="pointer-events-none absolute bg-line-strong"
      :class="[
        axis === 'x' ? 'inset-y-0 -left-[1px] w-0.5' : 'inset-x-0 -top-[1px] h-0.5',
        dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      ]"
    />
  </div>
</template>
