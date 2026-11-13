<script setup>
import { ref } from 'vue';

defineProps({ message: { type: String, default: '' } });
const dismissed = ref(false);
</script>

<template>
  <div v-if="message && !dismissed" class="runtime-config-notice" role="alert">
    <span>{{ message }}</span>
    <button type="button" aria-label="关闭配置提示" @click="dismissed = true">关闭</button>
  </div>
</template>

<style scoped>
.runtime-config-notice {
  position: fixed;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: min(800px, calc(100vw - 32px));
  padding: 12px 16px;
  border: 1px solid #bf8700;
  border-radius: 6px;
  background: #fff8c5;
  color: #3b2300;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.runtime-config-notice button {
  flex-shrink: 0;
  padding: 4px 8px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
</style>
