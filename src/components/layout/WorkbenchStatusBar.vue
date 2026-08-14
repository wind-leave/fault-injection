<script setup>
import markup from '../../fragments/statusbar.html?raw';

defineProps({
  collapsed: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['toggle-collapse']);
</script>

<template>
  <div class="status-bar-shell" :class="{ 'is-collapsed': collapsed }" data-testid="status-bar">
    <div class="status-bar-content" v-html="markup"></div>
    <div class="status-bar-control">
      <button
        type="button"
        class="status-bar-toggle"
        data-testid="status-bar-toggle"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? '展开日志面板' : '收起日志面板'"
        :title="collapsed ? '展开日志面板' : '收起日志面板'"
        @click="emit('toggle-collapse')"
      >
        <span class="status-bar-toggle__icon" aria-hidden="true">{{ collapsed ? '⌃' : '⌄' }}</span>
      </button>
    </div>
  </div>
</template>
