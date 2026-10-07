<script setup>
import markup from '../../fragments/right-panel.html?raw';

defineProps({
  collapsed: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['toggle-collapse']);

function openTestPointAuthoring(event) {
  const entry = event.target?.closest?.('[data-open-edge-testpoint-page]');
  if (!entry) return;
  event.preventDefault();
  const edgeId = entry.dataset.edgeTestpointPageEdgeId || window.__GZ_STATE__?.selEdge || '';
  window.dispatchEvent(new CustomEvent('gz:open-testpoint-authoring', {
    detail: { edgeId, pointId: '' }
  }));
}
</script>

<template>
  <div class="right-inspector-shell" :class="{ 'is-collapsed': collapsed }" data-testid="right-inspector">
    <div class="right-inspector-content" v-html="markup" @click="openTestPointAuthoring"></div>
    <div class="right-panel-control">
      <button
        type="button"
        class="right-panel-toggle"
        data-testid="right-inspector-toggle"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? '展开属性面板' : '收起属性面板'"
        :title="collapsed ? '展开属性面板' : '收起属性面板'"
        @click="emit('toggle-collapse')"
      >
        <span class="right-panel-toggle__icon" aria-hidden="true">{{ collapsed ? '‹' : '›' }}</span>
      </button>
    </div>
  </div>
</template>
