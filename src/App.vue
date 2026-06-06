<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import WorkbenchHeader from './components/layout/WorkbenchHeader.vue';
import LeftPalette from './components/layout/LeftPalette.vue';
import CanvasWorkbench from './components/layout/CanvasWorkbench.vue';
import RightInspector from './components/layout/RightInspector.vue';
import WorkbenchStatusBar from './components/layout/WorkbenchStatusBar.vue';
import FaultLibraryDialog from './components/dialogs/FaultLibraryDialog.vue';
import TemplateDialog from './components/dialogs/TemplateDialog.vue';
import ElectricalFaultDialog from './components/dialogs/ElectricalFaultDialog.vue';
import ProtocolFaultDialog from './components/dialogs/ProtocolFaultDialog.vue';
import ConfigDialog from './components/dialogs/ConfigDialog.vue';
import ScopeDialog from './components/dialogs/ScopeDialog.vue';
import PythonBindingDialog from './components/dialogs/PythonBindingDialog.vue';
import ComponentAuthoringDialog from './components/dialogs/ComponentAuthoringDialog.vue';
import FaultAuthoringDialog from './components/dialogs/FaultAuthoringDialog.vue';
import ToastHost from './components/dialogs/ToastHost.vue';
import { useWorkbenchState } from './composables/useWorkbenchState.js';
import { mountLegacyRuntime } from './services/legacyRuntimeBootstrap.js';
import { bindStatusBarInteractions, unbindStatusBarInteractions } from './services/statusBarRuntime.js';
import './services/simulationRuntime.js';

const workbench = useWorkbenchState();
const rootEl = ref(null);

const LAYOUT_STORAGE_KEY = 'gz.layoutSizes.v3';
const DEFAULT_LAYOUT_SIZES = Object.freeze({
  left: 192,
  right: 320,
  status: 100
});
const LAYOUT_LIMITS = Object.freeze({
  left: { min: 168, max: 360 },
  right: { min: 260, max: 460 },
  status: { min: 100, max: 180 },
  canvasMin: 560,
  splitterTotal: 12
});

let activeLayoutResize = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function readStoredLayoutSizes() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}');
    return {
      left: Number.isFinite(parsed.left) ? parsed.left : DEFAULT_LAYOUT_SIZES.left,
      right: Number.isFinite(parsed.right) ? parsed.right : DEFAULT_LAYOUT_SIZES.right,
      status: Number.isFinite(parsed.status) ? parsed.status : DEFAULT_LAYOUT_SIZES.status
    };
  } catch {
    return { ...DEFAULT_LAYOUT_SIZES };
  }
}

function getCurrentLayoutSizes() {
  const root = rootEl.value;
  if (!root) {
    return readStoredLayoutSizes();
  }
  const readVar = (name, fallback) => {
    const raw = root.style.getPropertyValue(name).trim();
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    left: readVar('--workbench-left-w', DEFAULT_LAYOUT_SIZES.left),
    right: readVar('--workbench-right-w', DEFAULT_LAYOUT_SIZES.right),
    status: readVar('--workbench-status-h', DEFAULT_LAYOUT_SIZES.status)
  };
}

function limitLayoutSizes(sizes, mainRect = document.querySelector('.workbench-main')?.getBoundingClientRect()) {
  const maxPanelSpace = mainRect?.width
    ? Math.max(0, mainRect.width - LAYOUT_LIMITS.canvasMin - LAYOUT_LIMITS.splitterTotal)
    : Number.POSITIVE_INFINITY;
  const rightMax = Math.min(LAYOUT_LIMITS.right.max, Math.max(LAYOUT_LIMITS.right.min, maxPanelSpace - LAYOUT_LIMITS.left.min));
  const right = clamp(sizes.right, LAYOUT_LIMITS.right.min, rightMax);
  const leftMax = Math.min(LAYOUT_LIMITS.left.max, Math.max(LAYOUT_LIMITS.left.min, maxPanelSpace - right));

  return {
    left: clamp(sizes.left, LAYOUT_LIMITS.left.min, leftMax),
    right,
    status: clamp(sizes.status, LAYOUT_LIMITS.status.min, LAYOUT_LIMITS.status.max)
  };
}

function applyLayoutSizes(sizes, options = {}) {
  const nextSizes = limitLayoutSizes(sizes, options.mainRect);
  const root = rootEl.value;
  if (root) {
    root.style.setProperty('--workbench-left-w', `${nextSizes.left}px`);
    root.style.setProperty('--workbench-right-w', `${nextSizes.right}px`);
    root.style.setProperty('--workbench-status-h', `${nextSizes.status}px`);
  }
  if (options.persist !== false) {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(nextSizes));
  }
  return nextSizes;
}

function handleLayoutResizeMove(event) {
  if (!activeLayoutResize) {
    return;
  }
  const { target, startY, startSizes, mainRect } = activeLayoutResize;
  const nextSizes = { ...startSizes };
  if (target === 'left') {
    nextSizes.left = event.clientX - mainRect.left;
  } else if (target === 'right') {
    nextSizes.right = mainRect.right - event.clientX;
  } else if (target === 'bottom') {
    nextSizes.status = startSizes.status + (startY - event.clientY);
  }
  applyLayoutSizes(nextSizes, { mainRect });
}

function stopLayoutResize() {
  if (!activeLayoutResize) {
    return;
  }
  activeLayoutResize = null;
  document.body.classList.remove('is-layout-resizing');
  window.removeEventListener('pointermove', handleLayoutResizeMove);
  window.removeEventListener('pointerup', stopLayoutResize);
}

function startLayoutResize(target, event) {
  if (event.button !== 0) {
    return;
  }
  const mainRect = document.querySelector('.workbench-main')?.getBoundingClientRect();
  if (!mainRect) {
    return;
  }
  event.preventDefault();
  activeLayoutResize = {
    target,
    startY: event.clientY,
    startSizes: getCurrentLayoutSizes(),
    mainRect
  };
  document.body.classList.add('is-layout-resizing');
  event.currentTarget?.setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', handleLayoutResizeMove);
  window.addEventListener('pointerup', stopLayoutResize);
}

function resetLayoutSize(target) {
  const sizes = getCurrentLayoutSizes();
  if (target === 'all') {
    applyLayoutSizes({ ...DEFAULT_LAYOUT_SIZES });
    return;
  }
  applyLayoutSizes({
    ...sizes,
    [target]: DEFAULT_LAYOUT_SIZES[target]
  });
}

onMounted(async () => {
  applyLayoutSizes(readStoredLayoutSizes(), { persist: false });
  await nextTick();
  mountLegacyRuntime();
  bindStatusBarInteractions();
  workbench.markReady();
});

onBeforeUnmount(() => {
  stopLayoutResize();
  unbindStatusBarInteractions();
});
</script>

<template>
  <div ref="rootEl" class="gz-app" data-testid="workbench-root" :data-runtime-ready="workbench.runtimeReady ? 'true' : 'false'">
    <WorkbenchHeader />
    <main class="workbench-main">
      <LeftPalette />
      <button
        type="button"
        class="layout-resizer layout-resizer--vertical layout-resizer--left"
        data-layout-resizer="left"
        aria-label="拖动调整左侧组件库宽度"
        title="拖动调整左侧组件库宽度，双击恢复默认"
        @pointerdown="startLayoutResize('left', $event)"
        @dblclick="resetLayoutSize('left')"
      ></button>
      <CanvasWorkbench />
      <button
        type="button"
        class="layout-resizer layout-resizer--vertical layout-resizer--right"
        data-layout-resizer="right"
        aria-label="拖动调整右侧属性面板宽度"
        title="拖动调整右侧属性面板宽度，双击恢复默认"
        @pointerdown="startLayoutResize('right', $event)"
        @dblclick="resetLayoutSize('right')"
      ></button>
      <RightInspector />
      <button
        type="button"
        class="layout-resizer layout-resizer--horizontal layout-resizer--bottom"
        data-layout-resizer="bottom"
        aria-label="拖动调整底部状态栏高度"
        title="拖动调整底部状态栏高度，双击恢复默认"
        @pointerdown="startLayoutResize('bottom', $event)"
        @dblclick="resetLayoutSize('status')"
      ></button>
      <WorkbenchStatusBar />
    </main>
    <FaultLibraryDialog />
    <TemplateDialog />
    <ElectricalFaultDialog />
    <ProtocolFaultDialog />
    <ConfigDialog />
    <ScopeDialog />
    <PythonBindingDialog />
    <ComponentAuthoringDialog />
    <FaultAuthoringDialog />
    <ToastHost />
  </div>
</template>
