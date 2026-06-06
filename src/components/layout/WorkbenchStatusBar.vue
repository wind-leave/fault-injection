<script setup>
import markup from '../../fragments/statusbar.html?raw';
</script>

<template>
  <div class="gz-shell-fragment" data-testid="status-bar" v-html="markup"></div>
</template>
