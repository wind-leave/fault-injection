<script setup>
import markup from '../../fragments/right-panel.html?raw';

defineProps({
  collapsed: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['toggle-collapse']);
</script>

<template>
  <div class="right-inspector-shell" :class="{ 'is-collapsed': collapsed }" data-testid="right-inspector">
    <div class="right-inspector-content" v-html="markup"></div>
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
