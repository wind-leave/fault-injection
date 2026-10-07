<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import markup from '../../fragments/canvas.html?raw';

const shell = ref(null);
let layoutObserver;

onMounted(() => {
  const canvas = shell.value?.querySelector('.canvas-wrap');
  const chrome = canvas?.querySelector('.canvas-chrome');
  if (!canvas || !chrome || typeof ResizeObserver === 'undefined') return;

  const updateLayout = () => {
    canvas.classList.toggle('is-compact-toolbar', canvas.getBoundingClientRect().width < 1000);
    canvas.style.setProperty('--canvas-toolbar-height', `${Math.ceil(chrome.getBoundingClientRect().height)}px`);
  };
  layoutObserver = new ResizeObserver(updateLayout);
  layoutObserver.observe(canvas);
  layoutObserver.observe(chrome);
  updateLayout();
});

onBeforeUnmount(() => layoutObserver?.disconnect());
</script>

<template>
  <div ref="shell" class="gz-shell-fragment" data-testid="canvas-workbench" v-html="markup"></div>
</template>
